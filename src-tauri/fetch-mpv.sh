#!/usr/bin/env bash
# Downloads the official mpv Windows build into src-tauri/mpv/ so the installer can bundle it.
# Pinned by SHA-256: a changed download fails the build instead of shipping unknown binaries to users.
set -euo pipefail
cd "$(dirname "$0")"
URL=https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-w64-mingw32.zip
SHA=a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de
[ -f mpv/mpv.exe ] && { echo "mpv already present"; exit 0; }
tmp=$(mktemp -d)
curl -fsSL -o "$tmp/mpv.zip" "$URL"
echo "$SHA  $tmp/mpv.zip" | sha256sum -c -
unzip -q "$tmp/mpv.zip" -d "$tmp/outer"   # the release zip wraps a second zip
mkdir -p mpv
unzip -q "$tmp"/outer/*.zip -d mpv
rm -f mpv/mpv-register.bat mpv/mpv-unregister.bat   # file-association helpers, not needed inside Marquee
rm -rf "$tmp"
echo "mpv ready: $(ls mpv | wc -l) files"
