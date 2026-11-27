use super::{
    VaultState, atomic_write, ensure_directory, invalid, is_note, locked_vault, metadata,
    vault_path,
};
use serde::Serialize;
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};
use tauri::{AppHandle, Manager, State, ipc::Response};
use tauri_plugin_dialog::DialogExt;

const MAX_ATTACHMENT: u64 = 50 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAsset {
    pub path: String,
    pub modified_ms: u64,
    pub bytes: u64,
}

fn attachment_bytes(path: &Path) -> io::Result<Vec<u8>> {
    let info = metadata(path)?.ok_or_else(invalid)?;
    if !info.is_file() || info.len() > MAX_ATTACHMENT {
        return Err(io::Error::other("Attachments must be at most 50 MiB"));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_ATTACHMENT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ATTACHMENT {
        return Err(invalid());
    }
    Ok(bytes)
}

fn read_attachment(root: &Path, relative: &str) -> io::Result<Vec<u8>> {
    let path = vault_path(root, relative)?;
    if is_note(&path) {
        return Err(invalid());
    }
    attachment_bytes(&path)
}

fn copy_attachment(root: &Path, source: &Path) -> io::Result<String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid)?;
    if is_note(source) || name.starts_with('.') || name.contains(['\\', ':', '\0']) {
        return Err(invalid());
    }
    let bytes = attachment_bytes(source)?;
    let directory = root.join("Attachments");
    ensure_directory(&directory)?;
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(invalid)?;
    let suffix = source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    for attempt in 1..=1000 {
        let name = if attempt == 1 {
            name.to_owned()
        } else {
            format!("{stem} ({attempt}){suffix}")
        };
        let relative = format!("Attachments/{name}");
        let destination = vault_path(root, &relative)?;
        match atomic_write(&destination, &bytes, true) {
            Ok(()) => return Ok(relative),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other(
        "Could not choose an unused attachment filename",
    ))
}

#[tauri::command]
pub async fn read_vault_attachment(
    state: State<'_, VaultState>,
    token: String,
    path: String,
) -> Result<Response, String> {
    locked_vault(&state, token, |vault| {
        read_attachment(&vault.root, &path)
            .map(Response::new)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn attach_vault_file(app: AppHandle, token: String) -> Result<Option<String>, String> {
    let Some(file) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let source = file.into_path().map_err(|error| error.to_string())?;
    let state = app.state::<VaultState>();
    locked_vault(&state, token, |vault| {
        copy_attachment(&vault.root, &source)
            .map(Some)
            .map_err(|error| error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copies_files_without_replacing_existing_assets() {
        let vault = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let path = local.path().join("A report.pdf");
        fs::write(&path, b"test attachment").unwrap();
        assert_eq!(
            copy_attachment(vault.path(), &path).unwrap(),
            "Attachments/A report.pdf"
        );
        fs::write(&path, b"replacement bytes").unwrap();
        assert_eq!(
            copy_attachment(vault.path(), &path).unwrap(),
            "Attachments/A report (2).pdf"
        );
        assert_eq!(
            read_attachment(vault.path(), "Attachments/A report.pdf").unwrap(),
            b"test attachment"
        );
    }

    #[test]
    fn checks_the_attachment_size_before_loading_it() {
        let vault = tempfile::tempdir().unwrap();
        let path = vault.path().join("Large.pdf");
        File::create(&path)
            .unwrap()
            .set_len(MAX_ATTACHMENT + 1)
            .unwrap();
        assert!(read_attachment(vault.path(), "Large.pdf").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_hidden_paths_markdown_and_symlinks() {
        let vault = tempfile::tempdir().unwrap();
        let local = tempfile::tempdir().unwrap();
        let path = local.path().join("secret.pdf");
        fs::write(&path, b"other folder").unwrap();
        fs::write(vault.path().join("Note.md"), b"note").unwrap();
        fs::write(vault.path().join(".private"), b"private").unwrap();
        std::os::unix::fs::symlink(&path, vault.path().join("alias.pdf")).unwrap();
        for path in ["alias.pdf", "../secret.pdf", ".private", "Note.md"] {
            assert!(read_attachment(vault.path(), path).is_err(), "{path}");
        }
    }
}
