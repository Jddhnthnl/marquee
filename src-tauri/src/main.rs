#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Map, Value};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

/// mpv properties the controls window shows, pushed to it as they change.
const PROPS: &[&str] = &["pause", "time-pos", "duration", "volume", "mute", "speed", "track-list", "sid", "aid",
    "media-title", "demuxer-cache-time", "paused-for-cache", "seeking", "chapter-list", "eof-reached"];

#[derive(Default)]
struct DiscordState(Mutex<Option<(String, DiscordIpcClient)>>);

#[derive(Default)]
struct Player {
    busy: AtomicBool,
    cmd: Mutex<Option<BufReader<File>>>, // second IPC connection, only for commands from the controls
    props: Mutex<Map<String, Value>>,    // latest value of each PROPS entry
    info: Mutex<Value>,                  // title details, episodes and sources, set by the main page
}

/// Main page → controls: what's playing (details, episodes, sources). Kept so a controls page that loads later can ask.
#[tauri::command]
fn set_player_info(app: AppHandle, state: State<'_, Player>, info: Value) {
    *state.info.lock().unwrap() = info.clone();
    let _ = app.emit_to("player", "player-info", info);
}

#[tauri::command]
fn player_info(state: State<'_, Player>) -> Value {
    state.info.lock().unwrap().clone()
}

/// Play a URL in mpv drawn inside Marquee's window with player.html floating over it as the controls
/// (Nuvio: libmpv + WebView2 overlay). Returns (position, duration) in seconds when playback ends.
#[tauri::command]
async fn play_mpv(app: AppHandle, window: WebviewWindow, url: String, title: String, start: f64, headers: Vec<String>, embed: bool) -> Result<(f64, f64), String> {
    let player = app.state::<Player>();
    if player.busy.swap(true, Ordering::SeqCst) { return Err("Something is already playing.".into()); }
    let _busy = Busy(&player.busy); // cleared on every return, including the early `?` ones
    if !embed { // mpv's own window and controls
        let a = app.clone();
        return tauri::async_runtime::spawn_blocking(move || session(&a, &url, &title, start, &headers, None)).await.map_err(|e| e.to_string()).and_then(|r| r);
    }
    let wid = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let overlay = WebviewWindowBuilder::new(&app, "player", WebviewUrl::App("player.html".into()))
        .parent(&window).map_err(|e| e.to_string())?
        .decorations(false).transparent(true).shadow(false).skip_taskbar(true).resizable(false).visible(false)
        .build();
    let res = match overlay {
        Ok(o) => {
            fit(&window, &o);
            // controls closed on their own (Alt+F4, crash): mpv has no other way out, so stop it
            let a = app.clone();
            o.on_window_event(move |e| if let WindowEvent::Destroyed = e {
                if let Some(c) = a.state::<Player>().cmd.lock().unwrap().as_mut() { let _ = request(c, &json!(["quit"])); }
            });
            let a = app.clone();
            let r = tauri::async_runtime::spawn_blocking(move || session(&a, &url, &title, start, &headers, Some(wid))).await
                .map_err(|e| e.to_string()).and_then(|r| r);
            let _ = o.close();
            r
        }
        Err(e) => Err(e.to_string()),
    };
    let _ = window.set_fullscreen(false);
    let _ = window.set_focus();
    res
}

struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
}

fn session(app: &AppHandle, url: &str, title: &str, start: f64, headers: &[String], wid: Option<isize>) -> Result<(f64, f64), String> {
    let pipe = format!(r"\\.\pipe\marquee-mpv-{}", std::process::id());
    let mut child = spawn_mpv(&pipe, url, title, start, headers, wid)?;
    let player = app.state::<Player>();
    player.props.lock().unwrap().clear();
    let (Some(events), Some(cmd)) = (connect(&pipe, &mut child), connect(&pipe, &mut child)) else {
        let _ = child.kill();
        return Err("mpv closed before playback started. The stream link may not work.".into());
    };
    *player.cmd.lock().unwrap() = Some(cmd);
    if let Some(o) = app.get_webview_window("player") {
        let _ = o.show();
        let _ = o.set_focus();
    }
    let (mut last_pos, mut last_cache) = (Instant::now(), Instant::now());
    watch(events, |name, v| {
        // next episode or another source: the old file's position must not be saved against the new one
        if name == "start-file" { player.props.lock().unwrap().clear(); }
        else { player.props.lock().unwrap().insert(name.into(), v.clone()); }
        // these change every frame; 5 updates a second is plenty for the seek bar
        let throttle = match name { "time-pos" => Some(&mut last_pos), "demuxer-cache-time" => Some(&mut last_cache), _ => None };
        if let Some(t) = throttle {
            if t.elapsed() < Duration::from_millis(200) { return; }
            *t = Instant::now();
            if let Some(w) = wid { raise_mpv(w); }
        }
        let _ = app.emit_to("player", "mpv", json!({ "name": name, "data": v }));
    });
    let _ = child.wait();
    *player.cmd.lock().unwrap() = None;
    let p = player.props.lock().unwrap();
    let f = |k: &str| p.get(k).and_then(Value::as_f64);
    Ok((f("time-pos").unwrap_or(start), f("duration").unwrap_or(0.0)))
}

/// Run an mpv command from the controls, e.g. ["cycle","pause"] or ["seek",10].
#[tauri::command]
async fn mpv_cmd(state: State<'_, Player>, args: Vec<Value>) -> Result<Value, String> {
    let mut g = state.cmd.lock().unwrap();
    request(g.as_mut().ok_or("Nothing is playing.")?, &Value::Array(args))
}

/// Everything known so far, for a controls page that loads after mpv already reported its state.
#[tauri::command]
fn mpv_state(state: State<'_, Player>) -> Map<String, Value> {
    state.props.lock().unwrap().clone()
}

/// Intro/recap/credits times from IntroDB. Done here because IntroDB's CORS only allows its own site.
#[tauri::command]
async fn introdb(imdb: String, season: u32, episode: u32) -> Result<Value, String> {
    if !(imdb.starts_with("tt") && imdb.len() > 2 && imdb[2..].bytes().all(|b| b.is_ascii_digit())) { return Err("bad IMDb id".into()); }
    let url = format!("https://api.introdb.app/segments?imdb_id={imdb}&season={season}&episode={episode}");
    let r = reqwest::Client::new().get(url).timeout(Duration::from_secs(8)).send().await.map_err(|e| e.to_string())?;
    r.json().await.map_err(|e| e.to_string())
}

/// "Another app" player: hand the link to the .exe the user picked.
#[tauri::command]
fn open_external(path: String, url: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) || !p.is_file() {
        return Err(format!("Marquee can't find {path}. Choose the app again in Settings > Playback."));
    }
    // links come from addons: anything else (e.g. "--script=...") would reach the player as an option
    if !is_web_url(&url) { return Err("Only web links can be sent to another app.".into()); }
    Command::new(p).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn is_web_url(u: &str) -> bool {
    let l = u.to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

#[tauri::command] // async: the blocking file picker must not run on the main thread
async fn pick_exe(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().add_filter("Programs", &["exe"]).blocking_pick_file().map(|f| f.to_string())
}

#[tauri::command]
fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    let main = app.get_webview_window("main").ok_or("No main window")?;
    let on = !main.is_fullscreen().map_err(|e| e.to_string())?;
    main.set_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(on)
}

/// The bundled mpv (installer puts it in <app>\mpv\) wins, then mpv.exe next to the exe, otherwise whatever is on PATH.
fn mpv_path() -> PathBuf {
    let dir = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    [r"mpv\mpv.exe", "mpv.exe"].iter()
        .filter_map(|f| dir.as_ref().map(|d| d.join(f)))
        .find(|p| p.exists())
        .unwrap_or_else(|| "mpv".into())
}

/// Check for updates on the stable or beta channel. Asks before installing so it never interrupts a film.
#[tauri::command]
async fn check_update(app: AppHandle, channel: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tauri_plugin_updater::UpdaterExt;
    let updater = if channel.as_deref() == Some("beta") {
        let beta_url = Url::parse("https://github.com/Jddhnthnl/marquee/releases/download/beta/latest-beta.json")
            .map_err(|e| e.to_string())?;
        app.updater_builder().endpoints(vec![beta_url]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?
    } else {
        app.updater().map_err(|e| e.to_string())?
    };
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { return Ok(None) };
    let ver = update.version.clone();
    let app2 = app.clone();
    app.dialog()
        .message(format!("Marquee {} is available. Install it now? Marquee will close and restart.", update.version))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom("Update now".into(), "Later".into()))
        .show(move |yes| if yes {
            tauri::async_runtime::spawn(async move {
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app2.restart(),
                    Err(e) => eprintln!("update failed: {e}"),
                }
            });
        });
    Ok(Some(ver))
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

#[tauri::command] // async: a hung Discord would otherwise freeze the main thread during the handshake
async fn discord_set(discord: State<'_, DiscordState>, app_id: String, details: String, status: Option<String>, start: Option<i64>) -> Result<(), String> {
    let mut lock = discord.0.lock().map_err(|_| "poisoned")?;
    let needs_new = match lock.as_ref() {
        Some((id, _)) if id == &app_id => false,
        _ => true,
    };
    if needs_new {
        if let Some((_, mut old)) = lock.take() { let _ = old.close(); }
        let mut client = DiscordIpcClient::new(&app_id).map_err(|e| e.to_string())?;
        if client.connect().is_ok() {
            *lock = Some((app_id, client));
        } else {
            return Err("discord not running".into());
        }
    }
    if let Some((_, client)) = lock.as_mut() {
        let mut act = activity::Activity::new().details(&details);
        if let Some(s) = status.as_deref() { act = act.state(s); }
        if let Some(ts) = start { act = act.timestamps(activity::Timestamps::new().start(ts)); }
        if client.set_activity(act).is_err() {
            let _ = client.close();
            *lock = None;
            return Err("discord disconnected".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn discord_clear(discord: State<'_, DiscordState>) -> Result<(), String> {
    let mut lock = discord.0.lock().map_err(|_| "poisoned")?;
    if let Some((_, mut client)) = lock.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
    Ok(())
}

fn spawn_mpv(pipe: &str, url: &str, title: &str, start: f64, headers: &[String], wid: Option<isize>) -> Result<Child, String> {
    let mut cmd = Command::new(mpv_path());
    if let Some(w) = wid {
        cmd.arg(format!("--wid={w}")) // video becomes a child window of Marquee's window
            // player.html is the UI; keep-open lets it run the next-episode card after the last frame
            .args(["--osc=no", "--input-default-bindings=no", "--input-vo-keyboard=no", "--input-cursor=no", "--keep-open=yes"]);
    }
    cmd.arg(format!("--input-ipc-server={pipe}"))
        .arg(format!("--start={start}"))
        .arg(format!("--force-media-title={title}"))
        .arg("--force-window=immediate")
        .creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no stray console behind the player
    for h in headers {
        cmd.arg(format!("--http-header-fields-append={h}")); // -append takes one item, so commas in values are safe
    }
    cmd.arg("--").arg(url).spawn().map_err(|e| {
        format!("Couldn't start mpv ({e}). Install it (winget install mpv-player.mpv-CI.MSVC) or put mpv.exe next to Marquee.exe.")
    })
}

/// Open mpv's IPC pipe, waiting up to 10s for mpv to create it. None if mpv exits first.
fn connect(pipe: &str, child: &mut Child) -> Option<BufReader<File>> {
    for _ in 0..100 {
        if let Ok(f) = OpenOptions::new().read(true).write(true).open(pipe) { return Some(BufReader::new(f)); }
        if !matches!(child.try_wait(), Ok(None)) { return None; }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

/// Observe PROPS and call `f` for every change until mpv closes the pipe.
fn watch(mut c: BufReader<File>, mut f: impl FnMut(&str, &Value)) {
    for (i, p) in PROPS.iter().enumerate() {
        if writeln!(c.get_mut(), "{}", json!({ "command": ["observe_property", i + 1, p] })).is_err() { return; }
    }
    let mut line = String::new();
    while matches!(c.read_line(&mut line), Ok(n) if n > 0) {
        if let Some((name, data)) = parse_change(&line) { f(&name, &data); }
        line.clear();
    }
}

/// One request/reply on mpv's JSON IPC; event lines in between are skipped.
fn request(c: &mut BufReader<File>, args: &Value) -> Result<Value, String> {
    writeln!(c.get_mut(), "{}", json!({ "command": args, "request_id": 1 })).map_err(|e| e.to_string())?;
    let mut line = String::new();
    loop {
        line.clear();
        if c.read_line(&mut line).map_err(|e| e.to_string())? == 0 { return Err("mpv closed".into()); }
        if let Some(r) = parse_reply(&line) { return r; }
    }
}

/// Some(result) for a reply line, None for event lines.
fn parse_reply(line: &str) -> Option<Result<Value, String>> {
    let v: Value = serde_json::from_str(line).ok()?;
    v.get("request_id")?;
    Some(match v["error"].as_str() {
        Some("success") => Ok(v.get("data").cloned().unwrap_or(Value::Null)),
        e => Err(e.unwrap_or("mpv error").to_string()),
    })
}

/// (name, value) for a property-change event; unavailable (null) values are dropped so the last real position survives shutdown.
/// ("start-file", null) when mpv starts another file, so the last file's values can be dropped then instead.
fn parse_change(line: &str) -> Option<(String, Value)> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("event")? == "start-file" { return Some(("start-file".into(), Value::Null)); }
    if v.get("event")? != "property-change" { return None; }
    let data = v.get("data").filter(|d| !d.is_null())?.clone();
    Some((v.get("name")?.as_str()?.to_string(), data))
}

/// Size the controls window over the main window's client area.
fn fit(main: &WebviewWindow, overlay: &WebviewWindow) {
    if let (Ok(p), Ok(s)) = (main.inner_position(), main.inner_size()) {
        let _ = overlay.set_position(p);
        let _ = overlay.set_size(s);
    }
}

/// mpv's child window starts below the webview; put it on top so the video covers Marquee's page.
/// Repeated while playing because the webview can re-raise itself (e.g. on resize).
fn raise_mpv(parent: isize) {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    unsafe {
        if let Ok(child) = FindWindowExW(Some(HWND(parent as _)), None, w!("mpv"), None) {
            let _ = SetWindowPos(child, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Player::default())
        .manage(DiscordState::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // the launch update check runs from app.js, which knows the profile's channel
            let main = app.get_webview_window("main").expect("main window");
            let m = main.clone();
            main.on_window_event(move |e| {
                if matches!(e, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                    if let Some(o) = m.get_webview_window("player") {
                        fit(&m, &o);
                        if let Ok(h) = m.hwnd() { raise_mpv(h.0 as isize); }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![play_mpv, mpv_cmd, mpv_state, toggle_fullscreen, set_player_info, player_info, introdb, open_external, pick_exe, check_update, notify, discord_set, discord_clear])
        .run(tauri::generate_context!())
        .expect("error while running Marquee");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_and_events() {
        assert_eq!(parse_reply(r#"{"data":12.5,"request_id":1,"error":"success"}"#), Some(Ok(json!(12.5))));
        assert_eq!(parse_reply(r#"{"request_id":1,"error":"property unavailable"}"#), Some(Err("property unavailable".into())));
        assert_eq!(parse_reply(r#"{"event":"playback-restart"}"#), None);
        assert_eq!(parse_change(r#"{"event":"property-change","id":2,"name":"time-pos","data":3.2}"#), Some(("time-pos".into(), json!(3.2))));
        assert_eq!(parse_change(r#"{"event":"property-change","id":2,"name":"time-pos"}"#), None);
        assert_eq!(parse_change(r#"{"request_id":0,"error":"success"}"#), None);
        // a new file (next episode, other source) starts: the old file's values must be dropped
        assert_eq!(parse_change(r#"{"event":"start-file","playlist_entry_id":2}"#), Some(("start-file".into(), Value::Null)));
    }

    #[test]
    fn only_web_links_go_to_other_players() {
        assert!(is_web_url("https://cdn.example/x.mkv") && is_web_url("HTTP://a.b/c"));
        assert!(!is_web_url("--script=\\\\evil\\x.lua") && !is_web_url("file:///C:/x") && !is_web_url("magnet:?xt=1"));
    }

    // Needs mpv on PATH and opens a window for ~4s: cargo test -- --ignored
    #[test]
    #[ignore]
    fn mpv_observes_and_obeys() {
        let pipe = r"\\.\pipe\marquee-mpv-test";
        let mut child = spawn_mpv(pipe, "av://lavfi:testsrc=duration=5", "Marquee test", 1.0, &[], None).unwrap();
        let events = connect(pipe, &mut child).expect("event pipe");
        let mut cmd = connect(pipe, &mut child).expect("command pipe");
        assert_eq!(request(&mut cmd, &json!(["set_property", "volume", 40])), Ok(Value::Null));
        let (mut pos, mut dur, mut vol) = (0.0, 0.0, 0.0);
        watch(events, |n, v| match n {
            "time-pos" => pos = v.as_f64().unwrap(),
            "duration" => dur = v.as_f64().unwrap(),
            "volume" => vol = v.as_f64().unwrap(),
            _ => {}
        });
        let _ = child.wait();
        assert!((dur - 5.0).abs() < 0.5, "duration {dur}");
        assert!(pos >= 2.0, "position {pos}");
        assert_eq!(vol, 40.0);
    }
}
