fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_cloud_workspace"])),
    )
    .expect("could not build Lekhan's desktop manifest");
}
