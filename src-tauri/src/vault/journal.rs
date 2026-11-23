use super::{
    INTERNAL, NoteChange, Vault, atomic_write, ensure_directory, ensure_note_parent, invalid,
    metadata, note_path,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};

const PENDING_LIMIT: u64 = 512 * 1024 * 1024;
const UPDATE_LIMIT: u64 = 64 * 1024 * 1024;
const INDEX_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
pub(super) struct PendingSave {
    pub(super) expected_revision: u64,
    pub(super) changes: Vec<NoteChange>,
    pub(super) index: Value,
    pub(super) sidecars: Vec<SidecarWrite>,
}

#[derive(Deserialize, Serialize)]
pub struct SidecarWrite {
    key: String,
    data: String,
    snapshot: bool,
}

#[derive(Serialize)]
pub struct NoteSidecar {
    key: String,
    snapshot: Option<String>,
    updates: Vec<String>,
}

fn sidecar_directory(root: &Path, key: &str) -> io::Result<PathBuf> {
    if uuid::Uuid::parse_str(key).is_err() || key.len() != 36 {
        return Err(invalid());
    }
    let metadata_directory = root.join(INTERNAL);
    let journals = metadata_directory.join("yjs");
    let directory = journals.join(key);
    for path in [&metadata_directory, &journals, &directory] {
        if metadata(path)?.is_some_and(|info| !info.is_dir()) {
            return Err(invalid());
        }
    }
    Ok(directory)
}

fn record_path(directory: &Path, revision: u64, snapshot: bool) -> PathBuf {
    directory.join(format!(
        "{revision}.{}",
        if snapshot { "snapshot" } else { "update" }
    ))
}

fn read_bytes(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let Some(info) = metadata(path)? else {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Journal file missing",
        ));
    };
    if !info.is_file() || info.len() > limit {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(invalid());
    }
    Ok(bytes)
}

fn records(directory: &Path, revision: u64) -> io::Result<Vec<(u64, bool, PathBuf)>> {
    if metadata(directory)?.is_none() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for item in fs::read_dir(directory)? {
        let item = item?;
        let path = item.path();
        let Some(number) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(|stem| stem.parse::<u64>().ok())
        else {
            continue;
        };
        let snapshot = match path.extension().and_then(|suffix| suffix.to_str()) {
            Some("snapshot") => true,
            Some("update") => false,
            _ => continue,
        };
        if number <= revision {
            result.push((number, snapshot, path));
        }
    }
    result.sort_unstable_by_key(|(revision, snapshot, _)| (*revision, *snapshot));
    Ok(result)
}

pub(super) fn read_sidecars(root: &Path, index: &Value) -> io::Result<Vec<NoteSidecar>> {
    let revision = index["revision"].as_u64().unwrap_or(0);
    let mut result = Vec::new();
    let mut remaining = PENDING_LIMIT;
    if let Some(pages) = index["pages"].as_array() {
        for key in pages.iter().filter_map(|page| page["sidecar"].as_str()) {
            let directory = sidecar_directory(root, key)?;
            let records = records(&directory, revision)?;
            let Some(base) = records.iter().rposition(|(_, snapshot, _)| *snapshot) else {
                // Markdown remains readable if a vault was copied without its Yjs state.
                continue;
            };
            let mut encoded = Vec::new();
            for (_, _, path) in &records[base..] {
                let bytes = read_bytes(path, UPDATE_LIMIT)?;
                remaining = remaining
                    .checked_sub(bytes.len() as u64)
                    .ok_or_else(invalid)?;
                encoded.push(STANDARD.encode(bytes));
            }
            let mut updates = encoded.into_iter();
            result.push(NoteSidecar {
                key: key.to_owned(),
                snapshot: updates.next(),
                updates: updates.collect(),
            });
        }
    }
    Ok(result)
}

impl PendingSave {
    fn revision(&self) -> Option<u64> {
        self.expected_revision.checked_add(1)
    }

    pub(super) fn validate(&self, root: &Path) -> io::Result<()> {
        if self.index["revision"].as_u64().is_none()
            || self.index["revision"].as_u64() != self.revision()
            || serde_json::to_vec(&self.index)?.len() > INDEX_LIMIT
        {
            return Err(invalid());
        }
        let mut keys = HashSet::new();
        let known_keys = self.index["pages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|page| page["sidecar"].as_str())
            .collect::<HashSet<_>>();
        for update in &self.sidecars {
            sidecar_directory(root, &update.key)?;
            if !known_keys.contains(update.key.as_str())
                || !keys.insert(&update.key)
                || update.data.len() as u64 > UPDATE_LIMIT.div_ceil(3) * 4
                || !STANDARD
                    .decode(&update.data)
                    .is_ok_and(|data| !data.is_empty() && data.len() as u64 <= UPDATE_LIMIT)
            {
                return Err(invalid());
            }
        }
        Ok(())
    }

    pub(super) fn persist_sidecars(&self, root: &Path) -> io::Result<()> {
        let revision = self.revision().ok_or_else(invalid)?;
        for update in &self.sidecars {
            let directory = sidecar_directory(root, &update.key)?;
            ensure_directory(&root.join(INTERNAL).join("yjs"))?;
            ensure_directory(&directory)?;
            let path = record_path(&directory, revision, update.snapshot);
            let bytes = STANDARD.decode(&update.data).map_err(io::Error::other)?;
            if bytes.is_empty() || bytes.len() as u64 > UPDATE_LIMIT {
                return Err(invalid());
            }
            match read_bytes(&path, UPDATE_LIMIT) {
                Ok(existing) if existing == bytes => {}
                Ok(_) => return Err(io::Error::other("vault_conflict")),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    atomic_write(&path, &bytes, true)?
                }
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    fn compact(&self, root: &Path) {
        let Some(revision) = self.revision() else {
            return;
        };
        for update in self.sidecars.iter().filter(|entry| entry.snapshot) {
            let Ok(directory) = sidecar_directory(root, &update.key) else {
                continue;
            };
            if let Ok(old) = records(&directory, revision.saturating_sub(1)) {
                for (_, _, path) in old {
                    // An interrupted cleanup is harmless. Reads start at the latest snapshot.
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    fn archive_conflict(
        &self,
        root: &Path,
        pending: &Path,
        discard_future_records: bool,
    ) -> io::Result<()> {
        let archive = root.join(INTERNAL).join("recovery");
        ensure_directory(&archive)?;
        let draft = archive.join(uuid::Uuid::new_v4().to_string());
        ensure_directory(&draft)?;
        for change in self.changes.iter().filter(|change| change.after.is_some()) {
            let path = note_path(&draft, &change.path)?;
            ensure_note_parent(&draft, &path)?;
            atomic_write(
                &path,
                change.after.as_deref().unwrap_or_default().as_bytes(),
                true,
            )?;
        }
        // Records newer than the committed index belong to the interrupted save.
        if discard_future_records {
            let revision = self.revision().ok_or_else(invalid)?;
            for update in &self.sidecars {
                let directory = sidecar_directory(root, &update.key)?;
                let record = record_path(&directory, revision, update.snapshot);
                if metadata(&record)?.is_some() {
                    fs::remove_file(record)?;
                }
            }
        }
        fs::rename(pending, draft.join("journal.json"))?;
        #[cfg(unix)]
        {
            File::open(&draft)?.sync_all()?;
            File::open(&archive)?.sync_all()?;
            File::open(root.join(INTERNAL))?.sync_all()?;
        }
        Ok(())
    }
}

impl Vault {
    pub(super) fn journal_lock(&self, create: bool) -> io::Result<Option<File>> {
        let directory = self.root.join(INTERNAL);
        if create {
            ensure_directory(&directory)?;
        } else if metadata(&directory)?.is_none() {
            return Ok(None);
        }
        let path = directory.join("write.lock");
        let exists = metadata(&path)?;
        if exists.as_ref().is_some_and(|info| !info.is_file()) {
            return Err(invalid());
        }
        let file = if create {
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)?
        } else if exists.is_some() {
            File::open(path)?
        } else {
            return Ok(None);
        };
        file.lock()?;
        Ok(Some(file))
    }

    pub(super) fn save(&self, save: PendingSave) -> Result<(), String> {
        let _lock = self.journal_lock(true).map_err(|error| error.to_string())?;
        self.recover()?;
        save.validate(&self.root)
            .map_err(|error| error.to_string())?;
        self.preflight(&save)?;
        let directory = self.root.join(INTERNAL);
        let pending = directory.join("pending.json");
        let record = serde_json::to_vec(&save).map_err(|error| error.to_string())?;
        if record.len() as u64 > PENDING_LIMIT {
            return Err("The vault save exceeds the recovery journal limit".into());
        }
        atomic_write(&pending, &record, true).map_err(|error| error.to_string())?;
        self.commit(&save)?;
        save.compact(&self.root);
        finish(&directory, &pending).map_err(|error| error.to_string())
    }

    pub(super) fn recover(&self) -> Result<bool, String> {
        let directory = self.root.join(INTERNAL);
        if metadata(&directory)
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(false);
        }
        let pending = directory.join("pending.json");
        let bytes = match read_bytes(&pending, PENDING_LIMIT) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        let save: PendingSave =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        save.validate(&self.root)
            .map_err(|error| error.to_string())?;
        let index = self.index().map_err(|error| error.to_string())?;
        if index["revision"].as_u64().unwrap_or(0) == save.expected_revision {
            match self.commit(&save) {
                Ok(()) => {}
                Err(error) if error == "vault_conflict" => {
                    save.archive_conflict(&self.root, &pending, true)
                        .map_err(|error| error.to_string())?;
                    self.mark_recovery();
                    return Ok(true);
                }
                Err(error) => return Err(error),
            }
        } else if index != save.index {
            // A different writer advanced the index. Keep its immutable records.
            save.archive_conflict(&self.root, &pending, false)
                .map_err(|error| error.to_string())?;
            self.mark_recovery();
            return Ok(true);
        }
        save.compact(&self.root);
        finish(&directory, &pending).map_err(|error| error.to_string())?;
        Ok(false)
    }
}

fn finish(directory: &Path, pending: &Path) -> io::Result<()> {
    fs::remove_file(pending)?;
    #[cfg(unix)]
    File::open(directory)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KEY: &str = "24f96a2d-d40e-4291-879c-fe61e374c8f6";

    fn saving(
        revision: u64,
        path: &str,
        before: Option<&str>,
        after: &str,
        data: &[u8],
        snapshot: bool,
    ) -> PendingSave {
        PendingSave {
            expected_revision: revision - 1,
            index: json!({ "revision": revision, "pages": [{ "sidecar": KEY }] }),
            changes: vec![NoteChange {
                path: path.into(),
                before: before.map(str::to_owned),
                after: Some(after.into()),
            }],
            sidecars: vec![SidecarWrite {
                key: KEY.into(),
                data: STANDARD.encode(data),
                snapshot,
            }],
        }
    }

    fn interrupt(vault: &Vault, save: &PendingSave) {
        let metadata = vault.root.join(INTERNAL);
        fs::create_dir_all(&metadata).unwrap();
        fs::write(
            metadata.join("pending.json"),
            serde_json::to_vec(save).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn appends_updates_and_compacts_after_the_index_commits() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::open(directory.path().into()).unwrap();
        vault
            .save(saving(1, "Note.md", None, "first", &[0, 0], true))
            .unwrap();
        vault
            .save(saving(
                2,
                "Note.md",
                Some("first"),
                "second",
                &[1, 2],
                false,
            ))
            .unwrap();
        let read = vault.read().unwrap();
        assert_eq!(read.sidecars[0].snapshot, Some("AAA=".into()));
        assert_eq!(read.sidecars[0].updates, vec!["AQI="]);
        let sidecar_dir = sidecar_directory(&vault.root, KEY).unwrap();
        assert!(sidecar_dir.join("1.snapshot").is_file());
        assert!(sidecar_dir.join("2.update").is_file());

        vault
            .save(saving(3, "Note.md", Some("second"), "third", &[3, 4], true))
            .unwrap();
        let read = vault.read().unwrap();
        assert_eq!(read.sidecars[0].snapshot, Some("AwQ=".into()));
        assert!(read.sidecars[0].updates.is_empty());
        assert_eq!(fs::read_dir(sidecar_dir).unwrap().count(), 1);
    }

    #[test]
    fn replays_an_interruption_between_markdown_and_index_without_duplicate_updates() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::open(directory.path().into()).unwrap();
        vault
            .save(saving(1, "Note.md", None, "first", &[0, 0], true))
            .unwrap();
        let pending = saving(2, "Note.md", Some("first"), "recovered", &[1, 2], false);
        interrupt(&vault, &pending);
        fs::write(vault.root.join("Note.md"), "recovered").unwrap();
        pending.persist_sidecars(&vault.root).unwrap();
        drop(vault);

        let reopened = Vault::open(directory.path().into()).unwrap();
        let read = reopened.read().unwrap();
        assert_eq!(read.index["revision"], 2);
        assert_eq!(read.files[0].text, "recovered");
        assert_eq!(read.sidecars[0].updates, vec!["AQI="]);
        assert!(!reopened.root.join(INTERNAL).join("pending.json").exists());
        assert_eq!(reopened.read().unwrap().sidecars[0].updates.len(), 1);
    }

    #[test]
    fn interrupted_app_draft_is_archived_if_the_disk_changed() {
        let directory = tempfile::tempdir().unwrap();
        let vault = Vault::open(directory.path().into()).unwrap();
        vault
            .save(saving(1, "Project/Note.md", None, "first", &[0, 0], true))
            .unwrap();
        let pending = saving(
            2,
            "Project/Note.md",
            Some("first"),
            "Lekhan draft",
            &[1, 2],
            false,
        );
        interrupt(&vault, &pending);
        pending.persist_sidecars(&vault.root).unwrap();
        fs::write(vault.root.join("Project/Note.md"), "edited elsewhere").unwrap();

        let read = vault.read().unwrap();
        assert_eq!(read.index["revision"], 1);
        assert!(read.recovered_drafts);
        assert_eq!(read.files[0].text, "edited elsewhere");
        assert!(read.sidecars[0].updates.is_empty());
        let recovery = vault.root.join(INTERNAL).join("recovery");
        let draft = fs::read_dir(recovery)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(draft.join("Project/Note.md")).unwrap(),
            "Lekhan draft"
        );
        assert!(draft.join("journal.json").is_file());
        assert!(!vault.root.join(INTERNAL).join("pending.json").exists());
        assert!(
            !sidecar_directory(&vault.root, KEY)
                .unwrap()
                .join("2.update")
                .exists()
        );
        vault
            .save(saving(
                2,
                "Project/Note.md",
                Some("edited elsewhere"),
                "new draft",
                &[3, 4],
                false,
            ))
            .unwrap();
        assert_eq!(vault.read().unwrap().sidecars[0].updates, vec!["AwQ="]);
    }
}
