use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, ipc::Channel};
use tokio::sync::watch;
use uuid::Uuid;

const MAX_BODY: usize = 1024 * 1024;
const MAX_STREAM: usize = 8 * 1024 * 1024;
const MAX_CALLS: usize = 8;
const MAX_CANCELLED: usize = 64;
const CANCEL_WINDOW: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct ProviderRequests(Mutex<Requests>);

#[derive(Default)]
struct Requests {
    active: HashMap<Uuid, watch::Sender<bool>>,
    cancelled: HashMap<Uuid, Instant>,
}

struct Pending<'a> {
    requests: &'a ProviderRequests,
    id: Uuid,
}

impl Drop for Pending<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.requests.0.lock() {
            registry.active.remove(&self.id);
        }
    }
}

impl ProviderRequests {
    fn begin(&self, id: Uuid) -> Result<(Pending<'_>, watch::Receiver<bool>), &'static str> {
        let mut registry = self.0.lock().map_err(|_| "network")?;
        registry
            .cancelled
            .retain(|_, time| time.elapsed() < CANCEL_WINDOW);
        if registry.cancelled.remove(&id).is_some() {
            return Err("cancelled");
        }
        if registry.active.len() >= MAX_CALLS || registry.active.contains_key(&id) {
            return Err("busy");
        }
        let (sender, receiver) = watch::channel(false);
        registry.active.insert(id, sender);
        Ok((Pending { requests: self, id }, receiver))
    }

    fn stop(&self, id: Uuid) {
        if let Ok(mut registry) = self.0.lock() {
            if let Some(sender) = registry.active.get(&id) {
                sender.send_replace(true);
                return;
            }
            registry
                .cancelled
                .retain(|_, time| time.elapsed() < CANCEL_WINDOW);
            if registry.cancelled.len() < MAX_CANCELLED {
                registry.cancelled.insert(id, Instant::now());
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderRequest {
    provider: String,
    url: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ProviderEvent {
    Head { status: u16 },
    Chunk { data: String },
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

fn is_qwen_host(host: &str) -> bool {
    if matches!(
        host,
        "dashscope.aliyuncs.com" | "dashscope-intl.aliyuncs.com" | "dashscope-us.aliyuncs.com"
    ) {
        return true;
    }
    let Some((workspace, region)) = host
        .strip_suffix(".maas.aliyuncs.com")
        .and_then(|name| name.split_once('.'))
    else {
        return false;
    };
    [workspace, region].into_iter().all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    })
}

fn checked_url(provider: &str, target: &str, has_body: bool) -> Result<Url, &'static str> {
    if target.len() > 2048 || target.contains('\\') {
        return Err("invalid");
    }
    let url = Url::parse(target).map_err(|_| "invalid")?;
    let loopback = is_loopback(&url);
    if url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
    {
        return Err("invalid");
    }
    if provider == "qwen" {
        let allowed = has_body
            && url.scheme() == "https"
            && url.port().is_none()
            && url.query().is_none()
            && url.host_str().is_some_and(is_qwen_host)
            && url.path() == "/compatible-mode/v1/chat/completions";
        return allowed.then_some(url).ok_or("invalid");
    }
    let base = match provider {
        "openai" => "https://api.openai.com/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "anthropic" => "https://api.anthropic.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta",
        "groq" => "https://api.groq.com/openai/v1",
        "zai" => "https://api.z.ai/api/paas/v4",
        "deepseek" => "https://api.deepseek.com",
        "sarvam" => "https://api.sarvam.ai/v2",
        "ollama" | "lmstudio" | "llamacpp" if !loopback => return Err("invalid"),
        "ollama" | "lmstudio" | "llamacpp" | "custom" => "",
        _ => return Err("invalid"),
    };
    if provider != "gemini" && url.query().is_some() {
        return Err("invalid");
    }
    let allowed = if base.is_empty() {
        let suffix = match (provider, has_body) {
            ("ollama", true) => "/api/chat",
            ("ollama", false) => "/api/tags",
            (_, true) => "/chat/completions",
            ("custom", false) => return Err("invalid"),
            (_, false) => "/models",
        };
        url.path().ends_with(suffix)
    } else if !has_body {
        false
    } else if provider == "gemini" {
        let model = url.as_str().strip_prefix(base).and_then(|suffix| {
            suffix
                .strip_prefix("/models/")
                .and_then(|path| path.strip_suffix(":streamGenerateContent?alt=sse"))
        });
        model.is_some_and(|name| !name.is_empty() && !name.contains('/'))
    } else {
        let expected = if provider == "anthropic" {
            "/messages"
        } else {
            "/chat/completions"
        };
        url.as_str().strip_prefix(base) == Some(expected)
    };
    allowed.then_some(url).ok_or("invalid")
}

fn checked_headers(
    provider: &str,
    values: BTreeMap<String, String>,
) -> Result<HeaderMap, &'static str> {
    let mut headers = HeaderMap::new();
    for (key, value) in values {
        let allowed = match (provider, key.as_str()) {
            ("anthropic", "x-api-key")
            | ("gemini", "x-goog-api-key")
            | ("sarvam", "api-subscription-key") => true,
            ("anthropic", "anthropic-version") => value == "2023-06-01",
            ("anthropic" | "gemini" | "sarvam", _) => false,
            (_, "Authorization") => value.starts_with("Bearer "),
            _ => false,
        };
        if !allowed || value.is_empty() || value.len() > 8192 {
            return Err("invalid");
        }
        let key = HeaderName::from_bytes(key.as_bytes()).map_err(|_| "invalid")?;
        let mut value = HeaderValue::from_str(&value).map_err(|_| "invalid")?;
        value.set_sensitive(true);
        headers.insert(key, value);
    }
    Ok(headers)
}

fn client() -> Result<Client, &'static str> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(
            "localhost",
            &[
                SocketAddr::from((Ipv4Addr::LOCALHOST, 0)),
                SocketAddr::from((Ipv6Addr::LOCALHOST, 0)),
            ],
        )
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(125))
        .build()
        .map_err(|_| "network")
}

static CLIENT: LazyLock<Result<Client, &'static str>> = LazyLock::new(client);

fn transport_error(error: reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else {
        "network"
    }
}

async fn send(
    request: ProviderRequest,
    mut cancelled: watch::Receiver<bool>,
    mut emit: impl FnMut(ProviderEvent) -> bool,
) -> Result<(), &'static str> {
    let has_body = request.body.is_some();
    let endpoint = checked_url(&request.provider, &request.url, has_body)?;
    let headers = checked_headers(&request.provider, request.headers)?;
    let client = CLIENT.as_ref().map_err(|error| *error)?;
    let payload = if let Some(body) = request.body {
        if body.len() > MAX_BODY {
            return Err("invalid");
        }
        client
            .post(endpoint)
            .header("content-type", "application/json")
            .body(body)
    } else {
        client.get(endpoint)
    };

    let mut response = tokio::select! {
        biased;
        _ = cancelled.changed() => return Err("cancelled"),
        response = payload.headers(headers).send() => response.map_err(transport_error)?,
    };
    let status = response.status();
    if !emit(ProviderEvent::Head {
        status: status.as_u16(),
    }) {
        return Ok(());
    }
    if !status.is_success() {
        return Ok(());
    }
    let limit = if has_body { MAX_STREAM } else { 512 * 1024 };
    let mut bytes = 0;
    loop {
        let next = tokio::select! {
            biased;
            _ = cancelled.changed() => return Err("cancelled"),
            next = response.chunk() => next.map_err(transport_error)?,
        };
        let Some(chunk) = next else {
            return Ok(());
        };
        bytes += chunk.len();
        if bytes > limit {
            return Err("response_limit");
        }
        for part in chunk.chunks(32 * 1024) {
            if !emit(ProviderEvent::Chunk {
                data: STANDARD.encode(part),
            }) {
                return Ok(());
            }
        }
    }
}

#[tauri::command]
pub async fn stream_provider_request(
    state: State<'_, ProviderRequests>,
    request_id: Uuid,
    request: ProviderRequest,
    output: Channel<ProviderEvent>,
) -> Result<(), String> {
    let (_pending, cancelled) = state.begin(request_id)?;
    send(request, cancelled, |event| output.send(event).is_ok())
        .await
        .map_err(str::to_owned)
}

#[tauri::command]
pub fn cancel_provider_request(state: State<'_, ProviderRequests>, request_id: Uuid) {
    state.stop(request_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn accepts_only_provider_protocol_routes() {
        for (provider, route) in [
            ("openai", "https://api.openai.com/v1/chat/completions"),
            (
                "openrouter",
                "https://openrouter.ai/api/v1/chat/completions",
            ),
            ("anthropic", "https://api.anthropic.com/v1/messages"),
            (
                "gemini",
                "https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent?alt=sse",
            ),
            ("groq", "https://api.groq.com/openai/v1/chat/completions"),
            ("zai", "https://api.z.ai/api/paas/v4/chat/completions"),
            ("deepseek", "https://api.deepseek.com/chat/completions"),
            (
                "qwen",
                "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
            ),
            (
                "qwen",
                "https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
            ),
            ("sarvam", "https://api.sarvam.ai/v2/chat/completions"),
            ("custom", "https://model.example/openai/v1/chat/completions"),
            ("custom", "http://localhost:9444/v1/chat/completions"),
            ("ollama", "http://localhost:11434/api/chat"),
            ("lmstudio", "http://127.0.0.1:1234/v1/chat/completions"),
            ("llamacpp", "http://[::1]:8080/v1/chat/completions"),
        ] {
            assert!(checked_url(provider, route, true).is_ok(), "{route}");
        }
        for (provider, route) in [
            (
                "openai",
                "https://api.openai.com.attacker.test/v1/chat/completions",
            ),
            ("openai", "https://api.openai.com/v1/models"),
            (
                "openai",
                "https://api.openai.com/v1/chat/completions?key=secret",
            ),
            (
                "gemini",
                "https://generativelanguage.googleapis.com/v1beta/models/a/b:streamGenerateContent?alt=sse",
            ),
            ("lmstudio", "https://elsewhere.example/v1/chat/completions"),
            (
                "qwen",
                "https://dashscope-intl.aliyuncs.com.other.example/compatible-mode/v1/chat/completions",
            ),
            (
                "qwen",
                "https://extra.ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
            ),
            (
                "qwen",
                "https://dashscope-intl.aliyuncs.com:444/compatible-mode/v1/chat/completions",
            ),
            (
                "qwen",
                "https://dashscope-intl.aliyuncs.com/elsewhere/chat/completions",
            ),
            ("custom", "http://elsewhere.example/v1/chat/completions"),
            (
                "custom",
                "https://name:secret@models.example/v1/chat/completions",
            ),
            ("custom", "https://models.example/redirect"),
            (
                "custom",
                "https://models.example/v1/chat/completions#fragment",
            ),
        ] {
            assert!(checked_url(provider, route, true).is_err(), "{route}");
        }
        assert!(checked_url("ollama", "http://localhost:11434/api/tags", false).is_ok());
        assert!(checked_url("llamacpp", "http://localhost:8080/v1/models", false).is_ok());
        assert!(checked_url("custom", "https://models.example/v1/models", false).is_err());
    }

    #[test]
    fn headers_are_provider_scoped_and_redacted() {
        let bearer = checked_headers(
            "ollama",
            BTreeMap::from([("Authorization".into(), "Bearer demo".into())]),
        )
        .unwrap();
        assert!(bearer["authorization"].is_sensitive());
        for (provider, name, value) in [
            ("openai", "Host", "other.example"),
            ("openai", "Cookie", "secret"),
            ("openai", "Authorization", "Bearer abc\r\nExtra: value"),
            ("gemini", "Authorization", "Bearer abc"),
            (
                "anthropic",
                "anthropic-dangerous-direct-browser-access",
                "true",
            ),
            ("anthropic", "anthropic-version", "other"),
        ] {
            assert!(
                checked_headers(provider, BTreeMap::from([(name.into(), value.into())])).is_err()
            );
        }
    }

    #[test]
    fn early_cancellation_and_duplicate_requests_are_bounded() {
        let requests = ProviderRequests::default();
        let id = Uuid::new_v4();
        requests.stop(id);
        assert!(matches!(requests.begin(id), Err("cancelled")));
        let (pending, receiver) = requests.begin(id).unwrap();
        assert!(matches!(requests.begin(id), Err("busy")));
        requests.stop(id);
        assert!(*receiver.borrow());
        drop(pending);
        assert!(requests.begin(id).is_ok());
    }

    fn local_exchange(
        status: &str,
        extra_headers: &str,
        body: &'static str,
    ) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
            body.len()
        );
        let handle = thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            connection
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = vec![0; 8192];
            let size = connection.read(&mut request).unwrap();
            request.truncate(size);
            connection.write_all(response.as_bytes()).unwrap();
            String::from_utf8(request).unwrap()
        });
        (port, handle)
    }

    #[tokio::test]
    async fn streams_a_loopback_provider_without_browser_headers() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n";
        let (port, server) = local_exchange("200 OK", "Content-Type: text/event-stream\r\n", sse);
        let request = ProviderRequest {
            provider: "lmstudio".into(),
            url: format!("http://localhost:{port}/v1/chat/completions"),
            headers: BTreeMap::from([("Authorization".into(), "Bearer fixture".into())]),
            body: Some(r#"{"stream":true}"#.into()),
        };
        let (_sender, stopped) = watch::channel(false);
        let mut status = 0;
        let mut bytes = Vec::new();
        send(request, stopped, |event| {
            match event {
                ProviderEvent::Head { status: http } => status = http,
                ProviderEvent::Chunk { data } => bytes.extend(STANDARD.decode(data).unwrap()),
            }
            true
        })
        .await
        .unwrap();
        let raw = server.join().unwrap().to_ascii_lowercase();
        assert!(raw.starts_with("post /v1/chat/completions http/1.1"));
        assert!(raw.contains("authorization: bearer fixture"));
        assert!(!raw.contains("origin:"));
        assert_eq!(status, 200);
        assert_eq!(bytes, sse.as_bytes());
    }

    #[tokio::test]
    async fn returns_status_without_following_redirects_or_reading_error_bodies() {
        let (port, server) = local_exchange(
            "307 Temporary Redirect",
            "Location: http://127.0.0.1:1/anything\r\n",
            "do not forward",
        );
        let (_sender, stopped) = watch::channel(false);
        let mut statuses = vec![];
        send(
            ProviderRequest {
                provider: "ollama".into(),
                url: format!("http://127.0.0.1:{port}/api/tags"),
                headers: BTreeMap::new(),
                body: None,
            },
            stopped,
            |event| match event {
                ProviderEvent::Head { status } => {
                    statuses.push(status);
                    true
                }
                ProviderEvent::Chunk { .. } => panic!("unexpected error body"),
            },
        )
        .await
        .unwrap();
        assert_eq!(statuses, vec![307]);
        assert!(server.join().unwrap().starts_with("GET /api/tags"));
    }
}
