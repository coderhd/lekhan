use super::{Model, check_gguf, install_model};
use reqwest::{
    Client, StatusCode, Url,
    header::{ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, RANGE},
    redirect::Policy,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, sync::watch};
use uuid::Uuid;

const GIB: u64 = 1024 * 1024 * 1024;
const ENTRIES: [CatalogModel; 3] = [
    CatalogModel {
        id: Uuid::from_u128(0xb817ecc337614d28acb9a28f59edd9d0),
        label: "SmolLM2 135M Instruct",
        bytes: 105_454_432,
        memory: GIB,
        strength: "quick",
        repository: "bartowski/SmolLM2-135M-Instruct-GGUF",
        revision: "09816acd5d99df7be770d85ea30822623dab342c",
        filename: "SmolLM2-135M-Instruct-Q4_K_M.gguf",
        sha256: "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d",
    },
    CatalogModel {
        id: Uuid::from_u128(0x52d4cbb74b5f4c089cd7d1c8b0618aae),
        label: "Qwen2.5 0.5B Instruct",
        bytes: 397_808_192,
        memory: 2 * GIB,
        strength: "draft",
        repository: "bartowski/Qwen2.5-0.5B-Instruct-GGUF",
        revision: "41ba88dbac95fed2528c92514c131d73eb5a174b",
        filename: "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
        sha256: "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653",
    },
    CatalogModel {
        id: Uuid::from_u128(0xf3c1db95c730453ab5096ee38fb5a6c8),
        label: "Qwen2.5 1.5B Instruct",
        bytes: 986_048_768,
        memory: 3 * GIB,
        strength: "rewrite",
        repository: "bartowski/Qwen2.5-1.5B-Instruct-GGUF",
        revision: "9eadc66189c7641e1ddd226b8267a9119b2ce2d4",
        filename: "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
        sha256: "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
    },
];

#[derive(Clone, Copy, Serialize)]
pub struct CatalogModel {
    id: Uuid,
    label: &'static str,
    bytes: u64,
    memory: u64,
    strength: &'static str,
    repository: &'static str,
    #[serde(skip)]
    revision: &'static str,
    #[serde(skip)]
    filename: &'static str,
    #[serde(skip)]
    sha256: &'static str,
}

impl CatalogModel {
    fn url(self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}?download=true",
            self.repository, self.revision, self.filename
        )
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Ready,
    Downloading,
    Pausing,
    Paused,
    Verifying,
    Failed,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TransferError {
    Network,
    InvalidFile,
    Storage,
}

#[derive(Serialize)]
pub struct CatalogItem {
    #[serde(flatten)]
    model: CatalogModel,
    phase: Phase,
    downloaded: u64,
    error: Option<TransferError>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    total_memory: Option<u64>,
    free_disk: Option<u64>,
}

#[derive(Default, Clone)]
pub(super) struct Downloads {
    jobs: Arc<Mutex<HashMap<Uuid, Transfer>>>,
}

struct Transfer {
    phase: Phase,
    error: Option<TransferError>,
    cancel: Option<watch::Sender<bool>>,
}

fn entry(id: Uuid) -> Result<CatalogModel, String> {
    ENTRIES
        .into_iter()
        .find(|model| model.id == id)
        .ok_or("Unknown catalog model.".into())
}

fn staging(root: &Path, id: Uuid) -> PathBuf {
    root.join(".downloads").join(id.to_string())
}

fn partial_bytes(root: &Path, id: Uuid) -> u64 {
    fs::symlink_metadata(staging(root, id).join("model.gguf"))
        .ok()
        .filter(|info| info.is_file())
        .map_or(0, |info| info.len())
}

pub(super) fn capacity(root: &Path) -> Capacity {
    static MEMORY: OnceLock<Option<u64>> = OnceLock::new();
    let total_memory = *MEMORY.get_or_init(|| {
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        let bytes = system.total_memory();
        (bytes > 0).then_some(bytes)
    });
    let free_disk = root
        .ancestors()
        .find(|path| path.is_dir())
        .and_then(|path| fs4::available_space(path).ok());
    Capacity {
        total_memory,
        free_disk,
    }
}

impl Downloads {
    pub(super) fn catalog(&self, root: &Path) -> Result<Vec<CatalogItem>, String> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| "Could not open the model downloads.")?;
        Ok(ENTRIES
            .into_iter()
            .map(|model| {
                let downloaded = partial_bytes(root, model.id).min(model.bytes);
                let job = jobs.get(&model.id);
                CatalogItem {
                    model,
                    downloaded,
                    phase: job.map_or(
                        if downloaded > 0 {
                            Phase::Paused
                        } else {
                            Phase::Ready
                        },
                        |job| job.phase,
                    ),
                    error: job.and_then(|job| job.error),
                }
            })
            .collect())
    }

    pub(super) fn start(&self, root: PathBuf, id: Uuid) -> Result<(), String> {
        let model = entry(id)?;
        let limits = capacity(&root);
        let remaining = model.bytes.saturating_sub(partial_bytes(&root, id));
        if limits
            .total_memory
            .is_some_and(|total| total < model.memory)
        {
            return Err("This device does not meet the model’s estimated memory needs.".into());
        }
        if limits.free_disk.is_some_and(|free| free < remaining) {
            return Err("Free up disk space before downloading this model.".into());
        }

        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "Could not open the model downloads.")?;
        if jobs.get(&id).is_some_and(|job| job.cancel.is_some()) {
            return Ok(());
        }
        if root.join(id.to_string()).exists() {
            return Err("This model is already in the library.".into());
        }
        let (sender, receiver) = watch::channel(false);
        jobs.insert(
            id,
            Transfer {
                phase: Phase::Downloading,
                error: None,
                cancel: Some(sender),
            },
        );
        drop(jobs);
        let downloads = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                let client = model_client()?;
                download(&client, &model.url(), &root, model, receiver, || {
                    downloads.verifying(id)
                })
                .await
            }
            .await;
            if let Ok(mut jobs) = downloads.jobs.lock() {
                match result {
                    Ok(true) => {
                        jobs.remove(&id);
                    }
                    Ok(false) => {
                        jobs.insert(
                            id,
                            Transfer {
                                phase: Phase::Paused,
                                error: None,
                                cancel: None,
                            },
                        );
                    }
                    Err(error) => {
                        jobs.insert(
                            id,
                            Transfer {
                                phase: Phase::Failed,
                                error: Some(error),
                                cancel: None,
                            },
                        );
                    }
                }
            }
        });
        Ok(())
    }

    fn verifying(&self, id: Uuid) {
        if let Ok(mut jobs) = self.jobs.lock()
            && let Some(job) = jobs.get_mut(&id)
            && !matches!(job.phase, Phase::Pausing)
        {
            job.phase = Phase::Verifying;
        }
    }

    pub(super) fn pause(&self, id: Uuid) -> Result<(), String> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "Could not open the model downloads.")?;
        if let Some(job) = jobs.get_mut(&id)
            && let Some(cancel) = &job.cancel
        {
            job.phase = Phase::Pausing;
            let _ = cancel.send(true);
        }
        Ok(())
    }

    pub(super) fn discard(&self, root: &Path, id: Uuid) -> Result<(), String> {
        entry(id)?;
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| "Could not open the model downloads.")?;
        if jobs.get(&id).is_some_and(|job| job.cancel.is_some()) {
            return Err("Pause the download before removing its files.".into());
        }
        if fs::symlink_metadata(root.join(".downloads")).is_ok_and(|info| !info.is_dir()) {
            return Err("Could not open the model download folder.".into());
        }
        let directory = staging(root, id);
        match fs::symlink_metadata(&directory) {
            Ok(info) if info.is_dir() => {
                fs::remove_dir_all(&directory).map_err(|error| error.to_string())?
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            _ => return Err("Could not remove the partial model.".into()),
        }
        jobs.remove(&id);
        Ok(())
    }
}

fn allowed_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            host == "huggingface.co"
                || host.ends_with(".huggingface.co")
                || host.ends_with(".hf.co")
        })
}

fn model_client() -> Result<Client, TransferError> {
    Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() < 8 && allowed_origin(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Untrusted model download redirect")
            }
        }))
        .build()
        .map_err(|_| TransferError::Network)
}

fn validate_range(
    headers: &reqwest::header::HeaderMap,
    offset: u64,
    total: u64,
    status: StatusCode,
) -> Result<u64, TransferError> {
    let accepted = match status {
        StatusCode::OK => 0,
        StatusCode::PARTIAL_CONTENT if offset > 0 => {
            let expected = format!("bytes {offset}-{}/{total}", total - 1);
            if headers
                .get(CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                != Some(expected.as_str())
            {
                return Err(TransferError::Network);
            }
            offset
        }
        _ => return Err(TransferError::Network),
    };
    if headers.get(CONTENT_LENGTH).is_some_and(|header| {
        header.to_str().ok().and_then(|value| value.parse().ok()) != Some(total - accepted)
    }) {
        return Err(TransferError::Network);
    }
    Ok(accepted)
}

fn ensure_path(root: &Path, id: Uuid) -> Result<PathBuf, TransferError> {
    let folder = staging(root, id);
    fs::create_dir_all(root).map_err(|_| TransferError::Storage)?;
    for directory in [&root.join(".downloads"), &folder] {
        match fs::symlink_metadata(directory) {
            Ok(info) if info.is_dir() => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(directory) {
                    Ok(()) => {}
                    Err(error)
                        if error.kind() == io::ErrorKind::AlreadyExists
                            && fs::symlink_metadata(directory).is_ok_and(|info| info.is_dir()) => {}
                    Err(_) => return Err(TransferError::Storage),
                }
            }
            _ => return Err(TransferError::Storage),
        }
    }
    let path = folder.join("model.gguf");
    if fs::symlink_metadata(&path).is_ok_and(|info| !info.is_file()) {
        return Err(TransferError::Storage);
    }
    Ok(path)
}

async fn download(
    client: &Client,
    url: &str,
    root: &Path,
    model: CatalogModel,
    mut pause: watch::Receiver<bool>,
    on_verifying: impl FnOnce(),
) -> Result<bool, TransferError> {
    let path = ensure_path(root, model.id)?;
    let offset = partial_bytes(root, model.id);
    if offset > model.bytes {
        fs::remove_file(&path).map_err(|_| TransferError::Storage)?;
        return Err(TransferError::InvalidFile);
    }
    if offset < model.bytes {
        let mut request = client.get(url).header(ACCEPT_ENCODING, "identity");
        if offset > 0 {
            request = request.header(RANGE, format!("bytes={offset}-"));
        }
        let mut response = tokio::select! {
            changed = pause.changed() => { let _ = changed; return Ok(false); }
            result = request.send() => result.map_err(|_| TransferError::Network)?,
        };
        let start = validate_range(response.headers(), offset, model.bytes, response.status())?;
        let mut partial = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(start > 0)
            .truncate(start == 0)
            .open(&path)
            .await
            .map_err(|_| TransferError::Storage)?;
        let mut bytes = start;
        let completed = loop {
            let chunk = tokio::select! {
                changed = pause.changed() => { let _ = changed; break false; }
                result = response.chunk() => result,
            };
            let chunk = match chunk {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break true,
                Err(_) => {
                    partial
                        .sync_data()
                        .await
                        .map_err(|_| TransferError::Storage)?;
                    return Err(TransferError::Network);
                }
            };
            bytes += chunk.len() as u64;
            if bytes > model.bytes {
                return Err(TransferError::InvalidFile);
            }
            partial
                .write_all(&chunk)
                .await
                .map_err(|_| TransferError::Storage)?;
        };
        partial
            .sync_all()
            .await
            .map_err(|_| TransferError::Storage)?;
        if !completed {
            return Ok(false);
        }
        if bytes != model.bytes {
            return Err(TransferError::Network);
        }
    }

    on_verifying();
    let root = root.to_owned();
    tauri::async_runtime::spawn_blocking(move || verify_and_install(&root, &path, model, pause))
        .await
        .map_err(|_| TransferError::Storage)?
}

fn verify_and_install(
    root: &Path,
    path: &Path,
    model: CatalogModel,
    pause: watch::Receiver<bool>,
) -> Result<bool, TransferError> {
    let mut file = File::open(path).map_err(|_| TransferError::Storage)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 128 * 1024];
    loop {
        if *pause.borrow() {
            return Ok(false);
        }
        let bytes = file.read(&mut buffer).map_err(|_| TransferError::Storage)?;
        if bytes == 0 {
            break;
        }
        hash.update(&buffer[..bytes]);
    }
    if *pause.borrow() {
        return Ok(false);
    }
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0))
        .map_err(|_| TransferError::Storage)?;
    let digest: String = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let valid = digest == model.sha256 && check_gguf(&mut file).is_ok();
    drop(file);
    if !valid {
        fs::remove_file(path).map_err(|_| TransferError::Storage)?;
        return Err(TransferError::InvalidFile);
    }
    install_model(
        root,
        &staging(root, model.id),
        Model {
            id: model.id,
            label: model.label.into(),
            bytes: model.bytes,
        },
    )
    .map_err(|_| TransferError::Storage)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
    };

    const FIXTURE: &[u8] = b"GGUF\x03\x00\x00\x00verified test weights";

    fn test_model() -> CatalogModel {
        CatalogModel {
            bytes: FIXTURE.len() as u64,
            sha256: "7b4f72c853c74139856787dd9c5c735ffa03dd3719d614552e5d1397d34734d2",
            ..ENTRIES[0]
        }
    }

    fn serve(
        status_and_headers: String,
        body: &'static [u8],
        expect_range: Option<String>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let task = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(&mut socket);
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                    break;
                }
                headers.push_str(&line.to_ascii_lowercase());
            }
            if let Some(range) = expect_range {
                assert!(headers.contains(&range), "{headers}");
            }
            write!(
                socket,
                "HTTP/1.1 {status_and_headers}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            socket.write_all(body).unwrap();
        });
        (format!("http://{address}/model.gguf"), task)
    }

    #[test]
    fn resumes_at_the_saved_offset_after_an_interrupted_download() {
        let directory = tempfile::tempdir().unwrap();
        let model = test_model();
        let count = 12;
        let (first, task) = serve(
            format!("200 OK\r\nContent-Length: {}", model.bytes),
            &FIXTURE[..count],
            None,
        );
        tauri::async_runtime::block_on(async {
            let client = Client::builder().no_proxy().build().unwrap();
            let (_hold, pause) = watch::channel(false);
            assert_eq!(
                download(&client, &first, directory.path(), model, pause, || {}).await,
                Err(TransferError::Network)
            );
            task.join().unwrap();
            assert_eq!(partial_bytes(directory.path(), model.id), count as u64);
            let (second, task) = serve(
                format!(
                    "206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}",
                    FIXTURE.len() - count,
                    count,
                    FIXTURE.len() - 1,
                    FIXTURE.len()
                ),
                &FIXTURE[count..],
                Some(format!("range: bytes={count}-")),
            );
            let (_hold, pause) = watch::channel(false);
            assert!(
                download(&client, &second, directory.path(), model, pause, || {})
                    .await
                    .unwrap()
            );
            task.join().unwrap();
            let path = super::super::model_path(directory.path(), model.id).unwrap();
            assert_eq!(fs::read(path).unwrap(), FIXTURE);
            assert_eq!(partial_bytes(directory.path(), model.id), 0);
        });
    }

    #[test]
    fn pausing_flushes_the_partial_file_and_leaves_it_visible_on_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let model = test_model();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (release, held) = std::sync::mpsc::channel();
        let task = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut requested = BufReader::new(&mut socket);
            loop {
                let mut line = String::new();
                if requested.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                    break;
                }
            }
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                model.bytes
            )
            .unwrap();
            socket.write_all(&FIXTURE[..12]).unwrap();
            socket.flush().unwrap();
            held.recv_timeout(Duration::from_secs(5)).unwrap();
        });
        tauri::async_runtime::block_on(async {
            let client = Client::builder().no_proxy().build().unwrap();
            let (stop, pause) = watch::channel(false);
            let stop_after_chunk = async {
                tokio::time::timeout(Duration::from_secs(3), async {
                    while partial_bytes(directory.path(), model.id) != 12 {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                })
                .await
                .unwrap();
                stop.send(true).unwrap();
            };
            let url = format!("http://{address}/model.gguf");
            let (result, ()) = tokio::join!(
                download(&client, &url, directory.path(), model, pause, || panic!(
                    "must not verify while paused"
                )),
                stop_after_chunk,
            );
            assert!(!result.unwrap());
        });
        release.send(()).unwrap();
        task.join().unwrap();
        let reopened = Downloads::default().catalog(directory.path()).unwrap();
        assert!(matches!(reopened[0].phase, Phase::Paused));
        assert_eq!(reopened[0].downloaded, 12);
    }

    #[test]
    fn rejects_unmatched_ranges_and_corrupt_complete_files() {
        let directory = tempfile::tempdir().unwrap();
        let model = test_model();
        let path = ensure_path(directory.path(), model.id).unwrap();
        fs::write(&path, &FIXTURE[..9]).unwrap();
        let (url, task) = serve(
            format!(
                "206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}",
                FIXTURE.len() - 8,
                8,
                FIXTURE.len() - 1,
                FIXTURE.len()
            ),
            &FIXTURE[8..],
            Some("range: bytes=9-".into()),
        );
        tauri::async_runtime::block_on(async {
            let client = Client::builder().no_proxy().build().unwrap();
            let (_hold, pause) = watch::channel(false);
            assert_eq!(
                download(&client, &url, directory.path(), model, pause, || {}).await,
                Err(TransferError::Network)
            );
            task.join().unwrap();
            assert_eq!(fs::read(&path).unwrap(), &FIXTURE[..9]);
            let mut altered = FIXTURE.to_vec();
            altered[9] ^= 1;
            fs::write(&path, altered).unwrap();
            let (_hold, pause) = watch::channel(false);
            assert_eq!(
                download(&client, &url, directory.path(), model, pause, || {}).await,
                Err(TransferError::InvalidFile)
            );
            assert!(!path.exists());
            assert!(!directory.path().join(model.id.to_string()).exists());
        });
    }

    #[test]
    fn live_small_model_resumes_and_checks_the_pinned_digest_when_requested() {
        if std::env::var_os("LEKHAN_TEST_MODEL_DOWNLOAD").is_none() {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let model = ENTRIES[0];
        tauri::async_runtime::block_on(async {
            let client = model_client().unwrap();
            let url = model.url();
            let mut initial = client
                .get(&url)
                .header(RANGE, "bytes=0-1048575")
                .send()
                .await
                .unwrap();
            assert_eq!(initial.status(), StatusCode::PARTIAL_CONTENT);
            let path = ensure_path(directory.path(), model.id).unwrap();
            let mut output = tokio::fs::File::create(path).await.unwrap();
            while let Some(bytes) = initial.chunk().await.unwrap() {
                output.write_all(&bytes).await.unwrap();
            }
            output.sync_all().await.unwrap();
            drop(output);
            assert_eq!(partial_bytes(directory.path(), model.id), 1024 * 1024);
            let (_hold, pause) = watch::channel(false);
            assert!(
                download(&client, &url, directory.path(), model, pause, || {})
                    .await
                    .unwrap()
            );
            assert_eq!(
                super::super::list(directory.path()).unwrap()[0].bytes,
                model.bytes
            );
        });
    }
}
