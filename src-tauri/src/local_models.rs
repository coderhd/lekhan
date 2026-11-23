mod runtime;

use runtime::Runtime;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State, ipc::Channel};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

#[derive(Default)]
pub struct LocalModels {
    runtime: Runtime,
}

impl LocalModels {
    pub fn stop(&self) {
        self.runtime.stop();
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    id: Uuid,
    label: String,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibrary {
    runtime_available: bool,
    models: Vec<Model>,
}

#[derive(Deserialize, Serialize)]
pub struct Message {
    role: String,
    content: String,
}

fn model_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models"))
}

fn invalid_model() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Choose a GGUF model supported by llama.cpp.",
    )
}

fn check_gguf(file: &mut File) -> io::Result<()> {
    let mut header = [0; 8];
    file.read_exact(&mut header).map_err(|_| invalid_model())?;
    if &header[..4] != b"GGUF"
        || !matches!(u32::from_le_bytes(header[4..].try_into().unwrap()), 2 | 3)
    {
        return Err(invalid_model());
    }
    Ok(())
}

fn model_path(root: &Path, id: Uuid) -> io::Result<PathBuf> {
    let folder = root.join(id.to_string());
    let path = folder.join("model.gguf");
    if !fs::symlink_metadata(&folder)?.is_dir() || !fs::symlink_metadata(&path)?.is_file() {
        return Err(invalid_model());
    }
    Ok(path)
}

fn list(root: &Path) -> io::Result<Vec<Model>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut models = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        let Ok(path) = model_path(root, id) else {
            continue;
        };
        let descriptor = entry.path().join("model.json");
        if !fs::symlink_metadata(&descriptor).is_ok_and(|info| info.is_file() && info.len() <= 8192)
        {
            continue;
        }
        let Ok(bytes) = fs::read(descriptor) else {
            continue;
        };
        let Ok(model) = serde_json::from_slice::<Model>(&bytes) else {
            continue;
        };
        if model.id == id && fs::metadata(path)?.len() == model.bytes {
            models.push(model);
        }
    }
    models.sort_unstable_by(|first, second| {
        first
            .label
            .cmp(&second.label)
            .then(first.id.cmp(&second.id))
    });
    Ok(models)
}

fn import(root: &Path, source: &Path) -> io::Result<Model> {
    use std::io::{Seek, SeekFrom, Write};
    if !fs::symlink_metadata(source)?.is_file() {
        return Err(invalid_model());
    }
    let mut input = File::open(source)?;
    check_gguf(&mut input)?;
    input.seek(SeekFrom::Start(0))?;
    let bytes = input.metadata()?.len();
    let label = source
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid_model)?
        .chars()
        .filter(|character| !character.is_control())
        .take(128)
        .collect::<String>();
    if label.trim().is_empty() {
        return Err(invalid_model());
    }

    fs::create_dir_all(root)?;
    let staging = tempfile::tempdir_in(root)?;
    let mut output = File::create(staging.path().join("model.gguf"))?;
    if io::copy(&mut input.take(bytes), &mut output)? != bytes {
        return Err(invalid_model());
    }
    output.sync_all()?;
    drop(output);
    let model = Model {
        id: Uuid::new_v4(),
        label,
        bytes,
    };
    let mut descriptor = File::create(staging.path().join("model.json"))?;
    descriptor.write_all(&serde_json::to_vec(&model)?)?;
    descriptor.sync_all()?;
    drop(descriptor);
    #[cfg(unix)]
    File::open(staging.path())?.sync_all()?;
    fs::rename(staging.path(), root.join(model.id.to_string()))?;
    #[cfg(unix)]
    File::open(root)?.sync_all()?;
    Ok(model)
}

#[tauri::command]
pub async fn list_local_models(app: AppHandle) -> Result<ModelLibrary, String> {
    Ok(ModelLibrary {
        runtime_available: runtime::executable().is_some(),
        models: list(&model_root(&app)?).map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
pub async fn import_local_model(app: AppHandle) -> Result<Option<Model>, String> {
    let Some(source) = app
        .dialog()
        .file()
        .set_title("Add a GGUF model")
        .add_filter("GGUF model", &["gguf"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = source.into_path().map_err(|error| error.to_string())?;
    let root = model_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        import(&root, &path)
            .map(Some)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn remove_local_model(
    app: AppHandle,
    state: State<'_, LocalModels>,
    id: Uuid,
) -> Result<(), String> {
    let _generation = state.runtime.try_idle()?;
    let root = model_root(&app)?;
    model_path(&root, id).map_err(|error| error.to_string())?;
    state.runtime.stop_model(id);
    fs::remove_dir_all(root.join(id.to_string())).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn generate_local_reply(
    app: AppHandle,
    state: State<'_, LocalModels>,
    id: Uuid,
    request_id: Uuid,
    messages: Vec<Message>,
    output: Channel<String>,
) -> Result<(), String> {
    let valid = !messages.is_empty()
        && messages.len() <= 64
        && messages.iter().any(|message| message.role == "user")
        && messages
            .iter()
            .all(|message| matches!(message.role.as_str(), "system" | "user" | "assistant"))
        && messages
            .iter()
            .map(|message| message.content.len())
            .sum::<usize>()
            <= 768 * 1024;
    if !valid {
        return Err("This prompt is too large or is missing a message.".into());
    }
    let path =
        model_path(&model_root(&app)?, id).map_err(|_| "Choose an installed local model.")?;
    state
        .runtime
        .generate(id, path, request_id, messages, |data| {
            output.send(data).is_ok()
        })
        .await
}

#[tauri::command]
pub fn cancel_local_reply(state: State<'_, LocalModels>, request_id: Uuid) {
    state.runtime.cancel(request_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_distinct_model_files_and_ignores_incomplete_models() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().join("library");
        let source = fixture.path().join("My model.gguf");
        fs::write(&source, b"GGUF\x03\x00\x00\x00rest of the model").unwrap();
        let model = import(&root, &source).unwrap();
        assert_eq!(model.label, "My model");
        assert_eq!(
            fs::read(model_path(&root, model.id).unwrap()).unwrap(),
            fs::read(&source).unwrap()
        );
        fs::create_dir(root.join(Uuid::new_v4().to_string())).unwrap();
        assert_eq!(list(&root).unwrap().len(), 1);
        fs::write(&source, b"not a GGUF model").unwrap();
        assert!(import(&root, &source).is_err());
        assert_eq!(list(&root).unwrap().len(), 1);
    }
}
