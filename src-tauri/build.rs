fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_cloud_workspace",
            "restore_vault",
            "choose_vault",
            "read_vault",
            "vault_sequence",
            "write_vault",
            "read_vault_attachment",
            "attach_vault_file",
        ]),
    ))
    .expect("could not build Lekhan's desktop manifest");
}
