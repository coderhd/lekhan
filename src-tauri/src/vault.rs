pub mod attachments;
mod journal;

use journal::{NoteSidecar, PendingSave, SidecarWrite, read_sidecars};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tempfile::NamedTempFile;

const INTERNAL: &str = ".lekhan";
const MAX_NOTE: u64 = 16 * 1024 * 1024;
const MAX_VAULT: u64 = 128 * 1024 * 1024;

#[derive(Default)]
pub struct VaultState(Mutex<Option<Vault>>);

struct Vault {
    root: PathBuf,
    token: String,
    sequence: Arc<AtomicU64>,
    recovered_drafts: AtomicBool,
    _watcher: RecommendedWatcher,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHandle {
    token: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    path: String,
    text: String,
    modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    sequence: u64,
    index: Value,
    files: Vec<Note>,
    assets: Vec<attachments::VaultAsset>,
    sidecars: Vec<NoteSidecar>,
    recovered_drafts: bool,
}

#[derive(Deserialize, Serialize)]
pub struct NoteChange {
    path: String,
    before: Option<String>,
    after: Option<String>,
}

fn missing(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::NotFound
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "Invalid vault path")
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["md", "markdown", "mdown"]
                .iter()
                .any(|item| extension.eq_ignore_ascii_case(item))
        })
}

fn metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(info) if info.is_symlink() => Err(invalid()),
        Ok(info) => Ok(Some(info)),
        Err(error) if missing(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

fn vault_path(root: &Path, relative: &str) -> io::Result<PathBuf> {
    let mut path = root.to_owned();
    let mut parts = relative.split('/').peekable();
    while let Some(part) = parts.next() {
        if part.is_empty() || part.starts_with('.') || part.contains(['\\', ':', '\0']) {
            return Err(invalid());
        }
        path.push(part);
        if let Some(info) = metadata(&path)? {
            let final_component = parts.peek().is_none();
            if (final_component && !info.is_file()) || (!final_component && !info.is_dir()) {
                return Err(invalid());
            }
        }
    }
    if path == root {
        return Err(invalid());
    }
    Ok(path)
}

fn note_path(root: &Path, relative: &str) -> io::Result<PathBuf> {
    let path = vault_path(root, relative)?;
    if !is_note(&path) {
        return Err(invalid());
    }
    Ok(path)
}

fn read_note(path: &Path) -> io::Result<Option<String>> {
    let Some(info) = metadata(path)? else {
        return Ok(None);
    };
    if !info.is_file() || info.len() > MAX_NOTE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Markdown file exceeds the local editor limit",
        ));
    }
    let mut text = String::new();
    File::open(path)?
        .take(MAX_NOTE + 1)
        .read_to_string(&mut text)?;
    if text.len() as u64 > MAX_NOTE {
        return Err(invalid());
    }
    Ok(Some(text))
}

fn ensure_directory(path: &Path) -> io::Result<()> {
    if let Some(info) = metadata(path)? {
        return if info.is_dir() {
            Ok(())
        } else {
            Err(invalid())
        };
    }
    fs::create_dir(path)?;
    #[cfg(unix)]
    File::open(path.parent().ok_or_else(invalid)?)?.sync_all()?;
    Ok(())
}

fn ensure_note_parent(root: &Path, path: &Path) -> io::Result<()> {
    let parent = path.parent().ok_or_else(invalid)?;
    let relative = parent.strip_prefix(root).map_err(|_| invalid())?;
    let mut directory = root.to_owned();
    for part in relative.components() {
        directory.push(part);
        ensure_directory(&directory)?;
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8], create: bool) -> io::Result<()> {
    let parent = path.parent().ok_or_else(invalid)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    if let Some(info) = metadata(path)? {
        if !info.is_file() {
            return Err(invalid());
        }
        temporary.as_file().set_permissions(info.permissions())?;
    }
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    if create {
        temporary.persist_noclobber(path)?;
    } else {
        temporary.persist(path)?;
    }
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

fn preference(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("vault-folder.json"))
}

fn mark_change(root: &Path, event: Event, sequence: &AtomicU64) {
    if event.kind.is_access() {
        return;
    }
    if event.paths.iter().any(|path| {
        path.strip_prefix(root).is_ok_and(|relative| {
            !relative
                .components()
                .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
        })
    }) {
        sequence.fetch_add(1, Ordering::Relaxed);
    }
}

impl Vault {
    fn open(root: PathBuf) -> io::Result<Self> {
        let root = root.canonicalize()?;
        if !root.is_dir() || root.parent().is_none() {
            return Err(invalid());
        }
        let sequence = Arc::new(AtomicU64::new(0));
        let changes = sequence.clone();
        let watch_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |result| match result {
            Ok(event) => mark_change(&watch_root, event, &changes),
            Err(_) => {
                changes.fetch_add(1, Ordering::Relaxed);
            }
        })
        .map_err(io::Error::other)?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(io::Error::other)?;
        let token = uuid::Uuid::new_v4().to_string();
        Ok(Self {
            root,
            token,
            sequence,
            recovered_drafts: AtomicBool::new(false),
            _watcher: watcher,
        })
    }

    fn handle(&self) -> VaultHandle {
        VaultHandle {
            token: self.token.clone(),
            label: self
                .root
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }
    }

    fn index(&self) -> io::Result<Value> {
        let directory = self.root.join(INTERNAL);
        if metadata(&directory)?.is_none() {
            return Ok(Value::Null);
        }
        let path = directory.join("index.json");
        if metadata(&path)?.is_none() {
            return Ok(Value::Null);
        }
        let mut bytes = Vec::new();
        File::open(path)?
            .take(MAX_NOTE + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_NOTE {
            return Err(invalid());
        }
        serde_json::from_slice(&bytes).map_err(io::Error::other)
    }

    fn walk(
        &self,
        directory: &Path,
        files: &mut Vec<Note>,
        assets: &mut Vec<attachments::VaultAsset>,
        remaining: &mut u64,
    ) -> io::Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with('.') || name.contains(['\\', ':']) {
                continue;
            }
            let path = entry.path();
            let kind = entry.file_type()?;
            if kind.is_dir() {
                self.walk(&path, files, assets, remaining)?;
            } else if kind.is_file() {
                let info = entry.metadata()?;
                let path_name = path
                    .strip_prefix(&self.root)
                    .map_err(|_| invalid())?
                    .components()
                    .map(|component| component.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                let modified_ms = info
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |duration| duration.as_millis() as u64);
                if !is_note(&path) {
                    assets.push(attachments::VaultAsset {
                        path: path_name,
                        modified_ms,
                        bytes: info.len(),
                    });
                    continue;
                }
                *remaining = remaining.checked_sub(info.len()).ok_or_else(|| {
                    io::Error::other("The Markdown vault exceeds the local editor limit")
                })?;
                let Some(text) = read_note(&path)? else {
                    continue;
                };
                files.push(Note {
                    path: path_name,
                    text,
                    modified_ms,
                });
            }
        }
        Ok(())
    }

    fn read(&self) -> io::Result<VaultSnapshot> {
        let _lock = self.journal_lock(false)?;
        self.recover().map_err(io::Error::other)?;
        let sequence = self.sequence.load(Ordering::Relaxed);
        let mut files = Vec::new();
        let mut assets = Vec::new();
        let mut remaining = MAX_VAULT;
        self.walk(&self.root, &mut files, &mut assets, &mut remaining)?;
        files.sort_unstable_by(|first, second| first.path.cmp(&second.path));
        let index = self.index()?;
        Ok(VaultSnapshot {
            sequence,
            sidecars: read_sidecars(&self.root, &index)?,
            index,
            files,
            assets,
            recovered_drafts: self.recovered_drafts.load(Ordering::Relaxed),
        })
    }

    fn mark_recovery(&self) {
        self.recovered_drafts.store(true, Ordering::Relaxed);
    }

    fn preflight<'a>(
        &self,
        save: &'a PendingSave,
    ) -> Result<Vec<(PathBuf, &'a NoteChange)>, String> {
        let current_revision = self.index().map_err(|error| error.to_string())?["revision"]
            .as_u64()
            .unwrap_or(0);
        if current_revision != save.expected_revision {
            return Err("vault_conflict".into());
        }
        let mut paths = HashSet::new();
        let mut edits = Vec::new();
        for change in &save.changes {
            let path = note_path(&self.root, &change.path).map_err(|error| error.to_string())?;
            if !paths.insert(&change.path)
                || change
                    .after
                    .as_ref()
                    .is_some_and(|text| text.len() as u64 > MAX_NOTE)
            {
                return Err("Invalid Markdown change".into());
            }
            let on_disk = read_note(&path).map_err(|error| error.to_string())?;
            if on_disk == change.after {
                continue;
            }
            if on_disk != change.before {
                return Err("vault_conflict".into());
            }
            edits.push((path, change));
        }
        Ok(edits)
    }

    fn commit(&self, save: &PendingSave) -> Result<(), String> {
        let edits = self.preflight(save)?;
        let run = || -> io::Result<()> {
            let directory = self.root.join(INTERNAL);
            ensure_directory(&directory)?;
            for (path, change) in &edits {
                if let Some(text) = &change.after {
                    ensure_note_parent(&self.root, path)?;
                    if read_note(path)? != change.before {
                        return Err(io::Error::other("vault_conflict"));
                    }
                    atomic_write(path, text.as_bytes(), change.before.is_none())?;
                }
            }
            let trash = directory.join("trash");
            for (path, change) in &edits {
                if change.after.is_none() {
                    ensure_directory(&trash)?;
                    if read_note(path)? != change.before {
                        return Err(io::Error::other("vault_conflict"));
                    }
                    // The trash directory and the note are in the same vault.
                    let bucket = trash.join(uuid::Uuid::new_v4().to_string());
                    fs::create_dir(&bucket)?;
                    fs::rename(path, bucket.join(path.file_name().ok_or_else(invalid)?))?;
                    #[cfg(unix)]
                    {
                        File::open(&bucket)?.sync_all()?;
                        File::open(&trash)?.sync_all()?;
                        File::open(path.parent().ok_or_else(invalid)?)?.sync_all()?;
                    }
                }
            }
            save.persist_sidecars(&self.root)?;
            atomic_write(
                &directory.join("index.json"),
                &serde_json::to_vec(&save.index)?,
                false,
            )?;
            Ok(())
        };
        run().map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                "vault_conflict".into()
            } else {
                error.to_string()
            }
        })?;
        Ok(())
    }
}

fn locked_vault<T>(
    state: &VaultState,
    token: String,
    run: impl FnOnce(&Vault) -> Result<T, String>,
) -> Result<T, String> {
    let lock = state.0.lock().map_err(|_| "Could not lock the vault")?;
    let vault = lock
        .as_ref()
        .filter(|vault| vault.token == token)
        .ok_or("The vault is no longer open")?;
    run(vault)
}

#[tauri::command]
pub async fn restore_vault(app: AppHandle) -> Result<Option<VaultHandle>, String> {
    let preference = preference(&app)?;
    let text = match fs::read_to_string(preference) {
        Ok(text) => text,
        Err(error) if missing(&error) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let path: PathBuf = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let state = app.state::<VaultState>();
    let mut lock = state.0.lock().map_err(|_| "Could not lock the vault")?;
    if let Some(vault) = lock.as_ref() {
        return Ok(Some(vault.handle()));
    }
    let vault = Vault::open(path).map_err(|error| error.to_string())?;
    let handle = vault.handle();
    *lock = Some(vault);
    Ok(Some(handle))
}

#[tauri::command]
pub async fn choose_vault(app: AppHandle) -> Result<Option<VaultHandle>, String> {
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Open Markdown vault")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|error| error.to_string())?;
    let vault = Vault::open(path).map_err(|error| error.to_string())?;
    vault.read().map_err(|error| error.to_string())?;
    let preference = preference(&app)?;
    fs::create_dir_all(
        preference
            .parent()
            .ok_or("Could not locate desktop settings")?,
    )
    .map_err(|error| error.to_string())?;
    let settings = serde_json::to_vec(&vault.root).map_err(|error| error.to_string())?;
    let state = app.state::<VaultState>();
    let mut lock = state.0.lock().map_err(|_| "Could not lock the vault")?;
    atomic_write(&preference, &settings, false).map_err(|error| error.to_string())?;
    let handle = vault.handle();
    *lock = Some(vault);
    Ok(Some(handle))
}

#[tauri::command]
pub async fn read_vault(
    state: State<'_, VaultState>,
    token: String,
) -> Result<VaultSnapshot, String> {
    locked_vault(&state, token, |vault| {
        vault.read().map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn vault_sequence(state: State<'_, VaultState>, token: String) -> Result<u64, String> {
    locked_vault(&state, token, |vault| {
        Ok(vault.sequence.load(Ordering::Relaxed))
    })
}

#[tauri::command]
pub async fn write_vault(
    state: State<'_, VaultState>,
    token: String,
    changes: Vec<NoteChange>,
    expected_revision: u64,
    index: Value,
    sidecars: Option<Vec<SidecarWrite>>,
) -> Result<(), String> {
    locked_vault(&state, token, |vault| {
        vault.save(PendingSave {
            changes,
            expected_revision,
            index,
            sidecars: sidecars.unwrap_or_default(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{Duration, Instant};

    fn edit(path: &str, before: Option<&str>, after: Option<&str>) -> NoteChange {
        NoteChange {
            path: path.into(),
            before: before.map(str::to_owned),
            after: after.map(str::to_owned),
        }
    }

    fn index(revision: u64) -> Value {
        json!({ "version": 1, "revision": revision, "pages": [] })
    }

    impl Vault {
        fn apply(
            &self,
            changes: Vec<NoteChange>,
            expected_revision: u64,
            index: Value,
        ) -> Result<(), String> {
            self.save(PendingSave {
                changes,
                expected_revision,
                index,
                sidecars: Vec::new(),
            })
        }
    }

    #[test]
    fn opens_existing_markdown_and_ignores_metadata() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        fs::create_dir_all(root.join("Projects")).unwrap();
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(
            root.join("Projects/Outline.md"),
            "---\r\ntitle: Outline\r\n---\r\nBody\r\n",
        )
        .unwrap();
        fs::write(root.join(".obsidian/Plugin.md"), "ignore me").unwrap();
        fs::write(root.join("Projects/data.csv"), "not a note").unwrap();
        let vault = Vault::open(root.into()).unwrap();
        let read = vault.read().unwrap();
        assert_eq!(read.files.len(), 1);
        assert_eq!(read.files[0].path, "Projects/Outline.md");
        assert_eq!(
            read.files[0].text,
            "---\r\ntitle: Outline\r\n---\r\nBody\r\n"
        );
    }

    #[test]
    fn writes_external_markdown_and_rejects_stale_saves_before_writing() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        fs::write(root.join("Seed.md"), "Draft").unwrap();
        let vault = Vault::open(root.into()).unwrap();
        vault
            .apply(
                vec![
                    edit("Seed.md", Some("Draft"), Some("Lekhan update")),
                    edit("Research/New.md", None, Some("Nested")),
                ],
                0,
                index(1),
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("Seed.md")).unwrap(),
            "Lekhan update"
        );
        assert_eq!(
            fs::read_to_string(root.join("Research/New.md")).unwrap(),
            "Nested"
        );
        fs::write(root.join("Seed.md"), "Outside update").unwrap();
        assert_eq!(
            vault
                .apply(
                    vec![
                        edit("Research/New.md", Some("Nested"), Some("Never written")),
                        edit("Seed.md", Some("Lekhan update"), Some("Stale"))
                    ],
                    1,
                    index(2)
                )
                .unwrap_err(),
            "vault_conflict"
        );
        assert_eq!(
            fs::read_to_string(root.join("Research/New.md")).unwrap(),
            "Nested"
        );
        assert_eq!(
            fs::read_to_string(root.join("Seed.md")).unwrap(),
            "Outside update"
        );
        vault
            .apply(
                vec![edit("Seed.md", Some("Outside update"), None)],
                1,
                index(2),
            )
            .unwrap();
        assert!(!root.join("Seed.md").exists());
        let trashed = fs::read_dir(root.join(".lekhan/trash"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(
            fs::read_to_string(trashed.path().join("Seed.md")).unwrap(),
            "Outside update"
        );
        assert_eq!(vault.read().unwrap().index["revision"], 2);
    }

    #[test]
    fn an_external_markdown_change_advances_the_watch_sequence() {
        let folder = tempfile::tempdir().unwrap();
        let vault = Vault::open(folder.path().into()).unwrap();
        let original = vault.read().unwrap().sequence;
        fs::write(folder.path().join("Edited elsewhere.md"), "A change").unwrap();
        let start = Instant::now();
        while vault.sequence.load(Ordering::Relaxed) == original
            && start.elapsed() < Duration::from_secs(4)
        {
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(vault.sequence.load(Ordering::Relaxed) > original);
        assert_eq!(vault.read().unwrap().files[0].text, "A change");
    }

    #[cfg(unix)]
    #[test]
    fn cannot_read_or_write_symlinked_notes_or_directories() {
        use std::os::unix::fs::symlink;
        let folder = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("Private.md"), "Private").unwrap();
        let root = folder.path();
        symlink(outside.path(), root.join("Other")).unwrap();
        symlink(outside.path().join("Private.md"), root.join("Alias.md")).unwrap();
        let vault = Vault::open(root.into()).unwrap();
        assert!(vault.read().unwrap().files.is_empty());
        for path in [
            "Other/New.md",
            "Alias.md",
            "../Escape.md",
            ".lekhan/State.md",
            "C:\\Outside.md",
        ] {
            assert!(
                vault
                    .apply(vec![edit(path, None, Some("New"))], 0, index(1))
                    .is_err(),
                "{path}"
            );
        }
        assert_eq!(
            fs::read_to_string(outside.path().join("Private.md")).unwrap(),
            "Private"
        );
        assert!(!outside.path().join("New.md").exists());
    }
}
