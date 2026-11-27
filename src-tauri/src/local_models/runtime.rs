use super::Message;
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::Client;
use serde_json::json;
use std::{
    collections::HashMap,
    net::{Ipv4Addr, TcpListener},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex as AsyncMutex, MutexGuard, watch};
use uuid::Uuid;

#[derive(Default)]
pub struct Runtime {
    process: Mutex<Option<Process>>,
    generation: AsyncMutex<()>,
    requests: Mutex<HashMap<Uuid, watch::Sender<bool>>>,
}

struct Process {
    id: Uuid,
    child: Child,
    connection: Connection,
}

#[derive(Clone)]
struct Connection {
    endpoint: String,
    key: String,
    alias: String,
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Request<'a> {
    runtime: &'a Runtime,
    id: Uuid,
}

impl Drop for Request<'_> {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.runtime.requests.lock() {
            requests.remove(&self.id);
        }
    }
}

pub(super) fn executable() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "lekhan-llama-server.exe"
    } else {
        "lekhan-llama-server"
    };
    let packaged = std::env::current_exe()
        .ok()
        .map(|path| path.with_file_name(name))
        .filter(|path| path.is_file());
    #[cfg(debug_assertions)]
    let packaged = packaged.or_else(|| {
        std::env::var_os("LEKHAN_LLAMA_SERVER")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.is_file())
    });
    packaged
}

fn loopback_client() -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "Could not initialize the local model connection.".into())
}

impl Runtime {
    pub(super) fn try_idle(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.generation
            .try_lock()
            .map_err(|_| "Wait for the current local reply to finish.".into())
    }

    pub(super) fn stop(&self) {
        if let Ok(mut process) = self.process.lock() {
            *process = None;
        }
    }

    pub(super) fn stop_model(&self, id: Uuid) {
        if let Ok(mut process) = self.process.lock()
            && process.as_ref().is_some_and(|process| process.id == id)
        {
            *process = None;
        }
    }

    pub(super) fn cancel(&self, id: Uuid) {
        if let Ok(requests) = self.requests.lock()
            && let Some(request) = requests.get(&id)
        {
            let _ = request.send(true);
        }
    }

    fn spawn(&self, id: Uuid, model: PathBuf) -> Result<Connection, String> {
        let mut guard = self
            .process
            .lock()
            .map_err(|_| "Could not reach the local model runtime.")?;
        if let Some(current) = guard.as_mut()
            && current.id == id
            && matches!(current.child.try_wait(), Ok(None))
        {
            return Ok(current.connection.clone());
        }
        *guard = None;

        let binary =
            executable().ok_or("This desktop build does not include the local model runtime.")?;
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not reserve a local model port.")?;
        let port = socket
            .local_addr()
            .map_err(|_| "Could not resolve the local model port.")?
            .port();
        let connection = Connection {
            endpoint: format!("http://127.0.0.1:{port}"),
            key: Uuid::new_v4().to_string() + &Uuid::new_v4().to_string(),
            alias: Uuid::new_v4().to_string(),
        };
        let mut command = Command::new(binary);
        command
            .arg("--model")
            .arg(model)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--alias",
                &connection.alias,
                "--ctx-size",
                "4096",
                "--parallel",
                "1",
                "--no-webui",
            ])
            .env("LLAMA_API_KEY", &connection.key)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        drop(socket);
        let child = command
            .spawn()
            .map_err(|_| "Could not start the bundled llama.cpp runtime.")?;
        *guard = Some(Process {
            child,
            id,
            connection: connection.clone(),
        });
        Ok(connection)
    }

    async fn ready(
        &self,
        id: Uuid,
        client: &Client,
        connection: &Connection,
    ) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            {
                let mut guard = self
                    .process
                    .lock()
                    .map_err(|_| "Could not reach the local model runtime.")?;
                let process = guard
                    .as_mut()
                    .filter(|process| process.id == id)
                    .ok_or("The local model was stopped.")?;
                if !matches!(process.child.try_wait(), Ok(None)) {
                    *guard = None;
                    return Err("llama.cpp could not load this model. Check that the GGUF is supported and enough memory is available.".into());
                }
            }
            if let Ok(response) = client
                .get(connection.endpoint.clone() + "/v1/models")
                .bearer_auth(&connection.key)
                .timeout(Duration::from_secs(2))
                .send()
                .await
                && response.status().is_success()
                && let Ok(models) = response.json::<serde_json::Value>().await
                && models["data"].as_array().is_some_and(|models| {
                    models
                        .iter()
                        .any(|model| model["id"].as_str() == Some(&connection.alias))
                })
            {
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.stop_model(id);
                return Err("The local model did not finish loading in time.".into());
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    pub(super) async fn generate(
        &self,
        id: Uuid,
        model: PathBuf,
        request_id: Uuid,
        messages: Vec<Message>,
        emit: impl Fn(String) -> bool,
    ) -> Result<(), String> {
        let _generation = self.try_idle()?;
        let (sender, mut cancel) = watch::channel(false);
        self.requests
            .lock()
            .map_err(|_| "Could not start the local request.")?
            .insert(request_id, sender);
        let _request = Request {
            runtime: self,
            id: request_id,
        };
        let work = async {
            let client = loopback_client()?;
            let connection = self.spawn(id, model)?;
            self.ready(id, &client, &connection).await?;
            let mut response = client.post(connection.endpoint + "/v1/chat/completions")
                .bearer_auth(connection.key)
                .json(&json!({ "model": connection.alias, "messages": messages, "stream": true, "max_tokens": 512 }))
                .send().await.map_err(|_| "The local model stopped responding.")?;
            if !response.status().is_success() {
                return Err(format!(
                    "The local model could not answer (HTTP {}). Try a shorter prompt or a different GGUF.",
                    response.status().as_u16()
                ));
            }
            while let Some(bytes) = response
                .chunk()
                .await
                .map_err(|_| "The local model response was interrupted.")?
            {
                for chunk in bytes.chunks(16 * 1024) {
                    if !emit(STANDARD.encode(chunk)) {
                        return Ok(());
                    }
                }
            }
            Ok(())
        };
        tokio::select! {
            result = work => result,
            _ = cancel.changed() => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_from_an_actual_gguf_when_requested() {
        let Some(fixture) = std::env::var_os("LEKHAN_TEST_GGUF") else {
            return;
        };
        let runtime = Runtime::default();
        let received = Mutex::new(Vec::new());
        let model = Uuid::new_v4();
        tauri::async_runtime::block_on(runtime.generate(
            model,
            PathBuf::from(fixture),
            Uuid::new_v4(),
            vec![Message {
                role: "user".into(),
                content: "Say hello in one short sentence.".into(),
            }],
            |chunk| {
                received
                    .lock()
                    .unwrap()
                    .extend_from_slice(&STANDARD.decode(chunk).unwrap());
                true
            },
        ))
        .unwrap();
        let sse = String::from_utf8(received.into_inner().unwrap()).unwrap();
        assert!(sse.contains("[DONE]"), "{sse}");
        assert!(
            sse.lines()
                .filter_map(|line| line.strip_prefix("data: "))
                .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                .any(|event| event["choices"][0]["delta"]["content"]
                    .as_str()
                    .is_some_and(|content| !content.is_empty()))
        );
        let connection = runtime
            .process
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .connection
            .clone();
        let unauthorized = tauri::async_runtime::block_on(async {
            loopback_client().unwrap().post(connection.endpoint + "/v1/chat/completions")
                .json(&json!({ "model": connection.alias, "messages": [{ "role": "user", "content": "Hello" }] }))
                .send().await.unwrap().status()
        });
        assert_eq!(unauthorized, reqwest::StatusCode::UNAUTHORIZED);
        runtime.stop_model(model);
        assert!(runtime.process.lock().unwrap().is_none());
    }
}
