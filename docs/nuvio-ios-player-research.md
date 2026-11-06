# Nuvio iOS player: how it works, and what Marquee would need (xtool)

Researched 2026-11-06 from primary sources (GitHub API, repo files). Anything not read directly is marked UNVERIFIED.

## 1. Repos and iOS source layout

- Main repo: https://github.com/NuvioMedia/NuvioMobile (GPL-3.0, https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/LICENSE). Active branch is `cmp-rewrite` (not `main`). Latest release seen: 0.6.8-beta (2026-11-05) with Android APKs plus `nuvio-0.6.8-full-release.ipa`.
- Kotlin Multiplatform / Compose Multiplatform shared app in `composeApp/`. iOS Kotlin source sets: `composeApp/src/iosMain`, `iosFull`, `iosAppStore` (https://github.com/NuvioMedia/NuvioMobile/tree/cmp-rewrite/composeApp/src).
- Native iOS host in `iosApp/` (Xcode project `iosApp/iosApp.xcodeproj`, Swift): `iosApp/iosApp/Player/` holds `MPVPlayerBridge.swift` (1486 lines), `MetalLayer.swift`, `NowPlayingController.swift`, `PlayerAudioSessionController.swift`, `PlayerPictureInPictureController.swift` (https://github.com/NuvioMedia/NuvioMobile/tree/cmp-rewrite/iosApp/iosApp/Player).
- Other Nuvio repos (not iOS-mobile): NuvioTV, NuvioDesktop, and an unofficial tvOS client https://github.com/bobsupra/NuvioTVOS. Not examined.

## 2. Player library: mpv via MPVKit (not AVPlayer, VLCKit or KSPlayer)

- `MPVPlayerBridge.swift` does `import Libmpv` and drives the libmpv C API directly: `mpv_create`, `mpv_set_option_string`, `mpv_initialize`, `mpv_observe_property`, `mpv_wait_event` (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/iosApp/iosApp/Player/MPVPlayerBridge.swift).
- mpv options set at init (same file, around lines 529-563): `wid` = pointer to a CAMetalLayer, `vo=gpu-next`, `gpu-api=vulkan`, `gpu-context=moltenvk`, `hwdec=videotoolbox`, `hwdec-software-fallback=300`, `target-colorspace-hint=yes`, `tone-mapping=auto`, `hdr-compute-peak=yes`, plus a bundled "Noto Sans" subtitle font via `sub-fonts-dir`.
- Dependency mechanism: a git submodule `MPVKit` pointing at https://github.com/NuvioMedia/MPVKit (branch `Nuvio`) (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/.gitmodules). The Xcode project references it as a local Swift package (`XCLocalSwiftPackageReference "../MPVKit"`, product `MPVKit`) (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/iosApp/iosApp.xcodeproj/project.pbxproj). Not CocoaPods, not Gradle cinterop for the player.
- The fork is of https://github.com/mpvkit/MPVKit (LGPL-3.0). Its `Package.swift` (`Nuvio` branch) is SwiftPM with many `.binaryTarget` xcframework zips: Libmpv, Libavcodec/Libavformat/etc. (FFmpeg), Libplacebo 7.360.1, MoltenVK 1.4.1, Libdav1d 1.5.2, OpenSSL 3.3.5, gnutls, libass, etc., platforms iOS 14+ (https://github.com/NuvioMedia/MPVKit/blob/Nuvio/Package.swift).
- Versions: FFmpeg/mpv set `0.41.0-n8.1.2` (mpv 0.41.0, FFmpeg n8.1.2). The Nuvio fork overrides the Libmpv xcframework with a custom build `0.41.0-n8.1.2-nuvio.5-long-form-video.2` hosted at https://github.com/WhiteGiso/MPVKit/releases (URL in the Package.swift above). Upstream MPVKit latest is 1.1.0-n9.0.2 (2026-10-07) (https://github.com/mpvkit/MPVKit/releases).
- The app links the non-GPL `MPVKit` product (LGPL build); a `MPVKit-GPL` product also exists with extra libs (Libsmbclient) but the pbxproj product is `MPVKit`. Reading from the pbxproj, not independently confirmed which product ends up in the shipped IPA beyond that.
- Separate Rust-ish "Nuvio Engine" xcframework (`NuvioEngine.xcframework`, v0.1.6) is downloaded in CI for plugins/P2P, unrelated to playback (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/scripts/prepare-ios-dependencies.sh).

## 3. Embedding in Compose Multiplatform

- Kotlin declares an interface `NuvioPlayerBridge` (about 60 methods: `loadFile`, `loadFileWithAudio(videoUrl, audioUrl, headersJson, subtitlesJson)`, `play/pause/seekTo/seekBy`, track getters/selectors, `applySubtitleStyle`, `configureVideoOutput(hwdec, tone mapping, HDR...)`, `getProperty`, `destroy`) and a `NuvioPlayerBridgeFactory.registerFactory(...)` registry (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/iosMain/kotlin/com/nuvio/app/features/player/PlayerBridge.kt).
- Swift implements it (`MPVPlayerBridgeImpl: NSObject, NuvioPlayerBridge`, imports `ComposeApp` framework) and registers at app start: `NuvioPlayerBridgeFactory.shared.registerFactory(creator: MPVPlayerBridgeCreator())` (MPVPlayerBridge.swift line ~1484). This avoids cinterop for a Swift-only package.
- Compose shows it with `UIKitViewController(factory = { bridge.createPlayerViewController() }, onResize = {...}, interactive = false)` inside a `Box` (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/iosMain/kotlin/com/nuvio/app/features/player/PlayerEngine.ios.kt, `actual fun PlatformPlayerSurface`). `interactive = false` so Compose gets the touches.
- Controls layering: the video is the UIKit view at the bottom; Compose draws the controls, plus a Compose `StyledSubtitleOverlay` (mpv `sub-text` is observed and rendered by Compose), on top. The same file has a `useNativeController` branch (details UNVERIFIED). Polling is by property getters (`getPositionMs`, `getIsPlaying`).
- System integration is native Swift: Now Playing / remote commands, audio session, Picture-in-Picture (a CAMetalLayer subclass with a presentation observer feeding a PiP controller) in the other Player/*.swift files.

## 4. Build, signing, distribution

- CI: `.github/workflows/android-release.yml` has an `ios` job on a macOS runner that runs `scripts/prepare-ios-dependencies.sh` then `scripts/build-ios-ipa.sh`: `xcodebuild` with `CODE_SIGNING_ALLOWED=NO`, then zips `Payload/Nuvio.app` into an unsigned IPA (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/scripts/build-ios-ipa.sh, https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/.github/workflows/ios-test-build.yml). Test workflow uses runner label `xcode-27`, Xcode 27.1.
- Distribution: unsigned IPA on GitHub Releases, installed via AltStore / SideStore with a source URL (`store.json`, updated by `update-store-source.yml`) (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/README.md). Bundle id `com.nuvio.media`. Users re-sign with their own Apple ID (so the 7-day free-account limit applies unless SideStore refresh).
- There is also an `iosAppStore` source set with a feature policy that disables plugins, P2P, custom server connections and trailers (https://github.com/NuvioMedia/NuvioMobile/blob/cmp-rewrite/composeApp/src/iosAppStore/kotlin/com/nuvio/app/core/build/AppFeaturePolicy.ios.kt). That suggests an App Store/TestFlight-compliant variant is prepared, but I did not find evidence it is published. UNVERIFIED.
- Licence: Nuvio is GPL-3.0 and ships mpv through the LGPL-3.0 MPVKit. Marquee's own licence/distribution plan decides whether the GPL build matters; the LGPL MPVKit product is dynamic-link friendly only if you keep it replaceable. Static linking in an App Store app is the usual LGPL friction. Not legal advice.

## 5. Limits relevant to Marquee

- Nuvio uses mpv's FFmpeg demuxers and its own libdav1d, so MKV, HEVC, AV1 and bitmap/ASS subtitles are handled in software or VideoToolbox (`hwdec=videotoolbox` with software fallback after 300 failures). No code-level evidence of format restrictions; I did not scan issues. UNVERIFIED for specific codecs.
- HDR: Nuvio sets `wantsExtendedDynamicRangeContent` on the CAMetalLayer and exposes tone-mapping / EDR settings (MPVPlayerBridge.swift lines ~365, ~786). Dolby Vision profile handling UNVERIFIED (Libdovi is bundled).
- The Vulkan-over-MoltenVK `gpu-next` path needs a Metal-capable device, the options `vulkan-disable-interop=yes` etc. suggest stability workarounds. Comment says VideoToolbox sessions can be invalidated during PiP.
- Nuvio's mpv build is customised ("long-form-video" nuvio.5). Stock MPVKit may behave differently.

## 6. Assessment for Marquee with xtool

### 6a. Can MPVKit be linked from an xtool SwiftPM build on Linux/WSL?

Evidence it is plausible but unproven:
- xtool is SwiftPM-based; its source has explicit `.binaryTarget` handling: it embeds `<name>.framework` into `Frameworks/` and signs it, skips static archives, and falls back to a `.dylib` (https://github.com/xtool-org/xtool/blob/main/Sources/PackLib/Packer.swift lines ~167-183, Planner.swift ~144). So xcframework binary targets from SwiftPM are an intended path.
- Known rough edges: xcframework naming mismatch and fat-static-archive detection (https://github.com/xtool-org/xtool/issues/130, open); `actool` failure on WSL2 when an `Assets.xcassets` exists, workaround is to remove it (https://github.com/xtool-org/xtool/issues/310, open).
- No xtool issue mentions MPVKit or libmpv (searched; zero results). Nobody has reported success or failure. UNVERIFIED that it links.
- MPVKit xcframeworks are mostly static libs; xtool must link them against the Darwin SDK it builds from your Xcode 27.1 xip. They need frameworks (Metal, VideoToolbox, AudioToolbox, CoreMedia...) and `libc++`/`bz2`/`xml2`, all declared via `linkerSettings` in the MPVKit Package.swift. Those system libs come from the extracted Darwin SDK, so likely OK. Risk: the Swift on Linux toolchain resolving a binary-target-only package that has a plain-Swift shim target (`Sources/_MPVKit`), and whether SwiftPM on Linux fetches the xcframework zips (it does support `binaryTarget(url:)` on Linux for Apple platforms, but UNVERIFIED for this package).
- xtool requirements (https://github.com/xtool-org/xtool/blob/main/Documentation/xtool.docc/Installation-Linux.md): Swift 6.4 toolchain, Xcode 27.1 xip downloaded manually, WSL2 with usbipd for the device, Apple ID.

Recommended first step before any real work: a throwaway xtool app that only does `import Libmpv` plus `mpv_create()`, `xtool dev` to the device. If that links and launches, the rest is ordinary Swift. If it fails, fall back to AVPlayer (MKV and several codecs unsupported) or a pre-built `.a` linked via a systemLibrary/C target.

### 6b. Design sketch: WKWebView UI + native mpv

Nuvio puts the player under the UI and draws controls in Compose. Marquee's UI is HTML, so mirror its desktop model (mpv under a transparent overlay):

- One `UIViewController` hosts: a bottom `UIView` with a `CAMetalLayer` (`wid` for mpv, same options as Nuvio) and a `WKWebView` on top with `isOpaque = false`, `backgroundColor = .clear`, `scrollView.backgroundColor = .clear`, so controls and the page draw over the video. Page toggles a body class for "playing" to make its background transparent.
- JS to native: `WKUserContentController.add(handler, name: "marquee")`; JS calls `window.webkit.messageHandlers.marquee.postMessage({cmd, args})`. Native to JS: `webView.evaluateJavaScript("window.__marqueeNative(\(json))")` for events (position tick, pause, tracks, ended, error), driven by `mpv_observe_property` (`time-pos`, `duration`, `pause`, `track-list`, `paused-for-cache`, `eof-reached`).
- Shim in the existing JS: wherever app.js/playback.js currently calls Tauri `invoke(...)`, route to a thin adapter that detects `window.webkit?.messageHandlers?.marquee` and uses it instead. Mapping (names from the brief; verify against the Rust commands):
  - `play_mpv(url, headers, start, subs...)` to native `play` -> `mpv_command(["loadfile", url])`, headers via `http-header-fields`, start via `start=`; external subs via `sub-add`.
  - `mpv_cmd(args[])` to a pass-through of `mpv_command`/`mpv_set_property_string` (keep one generic message type; this is the easiest 1:1 mapping, and Nuvio's property getter `getProperty(name)` is the same idea).
  - `set_player_info(...)` (title/artwork for system UI) to `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`, as Nuvio's `NowPlayingController.swift` does.
  - Stop/quit to `mpv_command(["stop"])` / `mpv_terminate_destroy`.
- No Tauri on iOS: the web assets must be bundled in the app and loaded with `loadFileURL`/a `WKURLSchemeHandler`; anything in Marquee that depends on Tauri plugins (fs, http, window management, the Rust backend) needs a JS or Swift replacement. This is the biggest hidden cost; scope what the Rust side currently does.
- Swift code authoring: you have no Swift or Mac; xtool needs Swift 6.4 inside WSL2. Debugging the Metal/mpv view without Xcode tooling is slower (logs via `xtool` console only).

## Top risks for Marquee

1. xtool plus MPVKit binary xcframeworks is untested by anyone I could find; a spike is required before committing.
2. Large non-player port: Tauri/Rust backend features have no iOS equivalent; needs Swift or JS replacements and a bundled-web-assets loading path.
3. Sideload constraints and licensing: free Apple ID gives 7-day installs; xtool's device path needs USB passthrough in WSL2. Mpv/FFmpeg are LGPL/GPL, so check licence terms for your distribution.

## Not verified

- Which exact MPVKit product (LGPL vs GPL) the shipped IPA uses.
- `useNativeController` behaviour in PlayerEngine.ios.kt.
- Whether the App Store variant (`iosAppStore`) is actually published.
- Any codec-specific bug reports (MKV/HEVC/Dolby Vision) in Nuvio's issue tracker.
- Whether xtool 1.21 links MPVKit end to end.
