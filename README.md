# Marquee

A Stremio-protocol media browser modelled on Nuvio: addons, home catalogs, search, details, streams, player with resume, library, profiles.

```
python -m http.server 8765 --bind 127.0.0.1   # then open http://127.0.0.1:8765 (8080 is blocked on this PC)
node protocol.test.mjs          # protocol self-tests
```

**Desktop app (like Nuvio):** `src-tauri/` wraps the same files in a Tauri window (WebView2, no server needed) and plays streams with **mpv drawn inside the Marquee window** (like Nuvio's embedded libmpv), so MKV/HEVC work. Marquee's own controls float over the video: seek, volume, picture size (Fit / Fill / Stretch), subtitles, audio, speed, and side panels for Episodes, Sources and Info, so you can switch episode or source without leaving the player. Paused and untouched for 5 seconds, it shows "You're watching" with the episode details. Keys: Space/K play, ←/→ 10s, ↑/↓ volume, M mute, F full screen, C subtitles, A picture size, N next episode, E episodes, I info, **Esc** closes a panel, then leaves full screen, then returns to Marquee (position saved).
```
cd src-tauri
./fetch-mpv.sh                # once: downloads the pinned official mpv build into src-tauri/mpv/ (bundled by the installer)
npx @tauri-apps/cli@2 dev     # run
npx @tauri-apps/cli@2 build   # installer: src-tauri/target/release/bundle/nsis/Marquee_<version>_x64-setup.exe
cargo test                    # mpv IPC parser test (add -- --include-ignored to also play a 5s clip in real mpv)
```
The installer ships mpv in `<install dir>\mpv\`; the app falls back to `mpv.exe` next to `Marquee.exe`, then mpv on PATH. Magnet links aren't playable: use a debrid service through your stream addon's settings. The desktop app keeps its own profiles/library, separate from the browser version.

**Releasing:** bump `version` in `src-tauri/tauri.conf.json`, commit, then `git tag v<version> && git push --tags`. GitHub Actions (`.github/workflows/release.yml`) builds, signs and publishes the release; installed copies offer the update on next launch. Local signed builds need `TAURI_SIGNING_PRIVATE_KEY` (contents of `~/.tauri/marquee.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`. Losing that key means installed copies can't verify future updates, so back it up.

**Install as a browser app (PWA):** with the server running, open http://127.0.0.1:8765 in Edge or Chrome and choose *Install Marquee* (the icon at the right of the address bar, or menu > Apps). It gets its own window, taskbar and Start menu entry. After the first visit the service worker (`sw.js`) caches the app, so it opens without the server; addon catalogs and streams still need internet.

Starts with Cinemeta installed. Add stream addons on the Addons page. Data lives in the browser's localStorage, per profile.
