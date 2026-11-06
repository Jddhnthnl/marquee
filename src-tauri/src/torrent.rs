//! Built-in torrent engine (desktop): downloads one video file sequentially and serves it on a loopback HTTP URL for mpv.
use librqbit::{AddTorrent, AddTorrentOptions, Session};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const VIDEO: [&str; 7] = ["mkv", "mp4", "avi", "webm", "m4v", "mov", "ts"];

pub fn dir() -> PathBuf { std::env::temp_dir().join("marquee-torrent") }

struct Live { session: Arc<Session>, server: tauri::async_runtime::JoinHandle<()> }

#[derive(Default)]
pub struct Torrents(tokio::sync::Mutex<Option<Live>>);

async fn stop(slot: &mut Option<Live>) {
    if let Some(l) = slot.take() {
        l.server.abort();
        l.session.stop().await;
        let _ = std::fs::remove_dir_all(dir());
    }
}

/// Starts (replacing any running torrent) and returns the http://127.0.0.1 URL of the chosen file.
#[tauri::command]
pub async fn torrent_start(state: State<'_, Torrents>, info_hash: String, file_idx: Option<usize>, trackers: Vec<String>) -> Result<String, String> {
    if info_hash.is_empty() || !info_hash.chars().all(|c| c.is_ascii_alphanumeric()) { return Err("bad info hash".into()); }
    let mut slot = state.0.lock().await;
    stop(&mut slot).await;
    let d = dir();
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let session = Session::new(d).await.map_err(|e| e.to_string())?;
    let opts = AddTorrentOptions { overwrite: true, trackers: Some(trackers.into_iter().filter(|t| t.starts_with("http") || t.starts_with("udp")).collect()), ..Default::default() };
    let added = tokio::time::timeout(Duration::from_secs(60), session.add_torrent(AddTorrent::from_url(info_hash), Some(opts)))
        .await.map_err(|_| "no peers found (timed out)".to_string())?.map_err(|e| e.to_string())?;
    let handle = added.into_handle().ok_or("torrent not added")?;
    let (idx, name) = handle.with_metadata(|m| {
        let files: Vec<(usize, String, u64)> = m.file_infos.iter().enumerate().map(|(i, f)| (i, f.relative_filename.to_string_lossy().into_owned(), f.len)).collect();
        let is_video = |n: &str| n.rsplit('.').next().is_some_and(|e| VIDEO.contains(&e.to_ascii_lowercase().as_str()));
        let pick = file_idx.filter(|i| *i < files.len())
            .or_else(|| files.iter().filter(|f| is_video(&f.1)).max_by_key(|f| f.2).map(|f| f.0))
            .or_else(|| files.iter().max_by_key(|f| f.2).map(|f| f.0));
        pick.map(|i| (i, files[i].1.clone()))
    }).map_err(|e| e.to_string())?.ok_or("the torrent has no files")?;
    session.update_only_files(&handle, &HashSet::from([idx])).await.map_err(|e| e.to_string())?;
    let ext = name.rsplit('.').next().filter(|e| VIDEO.contains(&e.to_ascii_lowercase().as_str())).unwrap_or("mkv").to_ascii_lowercase();
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // random path segment so other local pages can't pull the stream
    let token = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |t| t.as_nanos()) ^ (port as u128) << 64);
    let prefix = format!("/{token}/");
    let h = handle.clone();
    let server = tauri::async_runtime::spawn(async move {
        loop {
            let Ok((sock, _)) = listener.accept().await else { return };
            tauri::async_runtime::spawn(serve(sock, h.clone(), idx, prefix.clone()));
        }
    });
    *slot = Some(Live { session, server });
    Ok(format!("http://127.0.0.1:{port}/{token}/video.{ext}"))
}

#[tauri::command]
pub async fn torrent_stop(state: State<'_, Torrents>) -> Result<(), String> { stop(&mut *state.0.lock().await).await; Ok(()) }

/// "bytes=a-b" / "bytes=a-" against a file of `len` bytes -> inclusive (start, end).
fn range(h: &str, len: u64) -> Option<(u64, u64)> {
    let r = h.trim().strip_prefix("bytes=")?;
    let (a, b) = r.split_once('-')?;
    let (s, e) = match (a.trim(), b.trim()) {
        ("", n) => (len.saturating_sub(n.parse().ok()?), len.checked_sub(1)?),
        (s, "") => (s.parse().ok()?, len.checked_sub(1)?),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len.checked_sub(1)?)),
    };
    (s <= e && e < len).then_some((s, e))
}

async fn serve(mut sock: TcpStream, h: Arc<librqbit::ManagedTorrent>, idx: usize, prefix: String) {
    let mut buf = vec![0u8; 8192];
    let mut n = 0;
    while n < buf.len() { // read until the blank line that ends the request head
        let Ok(k) = sock.read(&mut buf[n..]).await else { return };
        if k == 0 { return; }
        n += k;
        if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") { break; }
    }
    let head = String::from_utf8_lossy(&buf[..n]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    if !path.starts_with(&prefix) { let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await; return; }
    let rng = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("range")).map(|(_, v)| v.to_string()));
    let Ok(mut st) = h.stream(idx).await else { let _ = sock.write_all(b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n").await; return };
    let len = st.len();
    let (s, e, status) = match rng.as_deref().map(|r| range(r, len)) {
        Some(Some((s, e))) => (s, e, "206 Partial Content"),
        Some(None) => { let _ = sock.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{len}\r\nContent-Length: 0\r\n\r\n").as_bytes()).await; return }
        None => (0, len.saturating_sub(1), "200 OK"),
    };
    let size = if len == 0 { 0 } else { e - s + 1 };
    let cr = if status.starts_with("206") { format!("Content-Range: bytes {s}-{e}/{len}\r\n") } else { String::new() };
    let hdr = format!("HTTP/1.1 {status}\r\nContent-Type: video/x-matroska\r\nAccept-Ranges: bytes\r\n{cr}Content-Length: {size}\r\nConnection: close\r\n\r\n");
    if sock.write_all(hdr.as_bytes()).await.is_err() || method == "HEAD" || size == 0 { return; }
    if st.seek(std::io::SeekFrom::Start(s)).await.is_err() { return; }
    let _ = tokio::io::copy(&mut st.take(size), &mut sock).await; // ends when mpv hangs up or seeks elsewhere
}
