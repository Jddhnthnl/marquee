fn main() {
    // tauri-build doesn't watch the icon, so a new icon.ico otherwise leaves the old one embedded in the exe
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
