#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod local_models;
mod vault;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const HOSTED_ORIGIN: &str = "https://www.lekhan.online";

fn parse_hosted_origin(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url)
}

fn hosted_origin() -> &'static Url {
    static ORIGIN: std::sync::OnceLock<Url> = std::sync::OnceLock::new();
    ORIGIN.get_or_init(|| {
        parse_hosted_origin(option_env!("LEKHAN_DESKTOP_CLOUD_ORIGIN").unwrap_or(HOSTED_ORIGIN))
            .expect("LEKHAN_DESKTOP_CLOUD_ORIGIN must be an HTTPS or loopback HTTP origin")
    })
}

fn hosted_url(path: &str) -> Url {
    hosted_origin().join(path).expect("valid Lekhan URL")
}

fn is_writer_url(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None)
    ) || cfg!(dev)
        && (url.scheme(), url.host_str(), url.port()) == ("http", Some("127.0.0.1"), Some(3192))
}

fn hosted_link(link: &Url) -> Option<Url> {
    if link.scheme() != "lekhan"
        || link.host_str() != Some("open")
        || link.port().is_some()
        || !link.username().is_empty()
        || link.password().is_some()
        || link.query().is_some()
        || link.fragment().is_some()
    {
        return None;
    }
    let route = link.path();
    let allowed = matches!(route, "/workspace" | "/cloud")
        || route
            .strip_prefix("/page/")
            .or_else(|| route.strip_prefix("/invite/"))
            .is_some_and(|id| uuid::Uuid::try_parse(id).is_ok() && id.len() == 36);
    allowed.then(|| hosted_url(route))
}

fn show_cloud(app: &AppHandle, destination: Option<Url>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("cloud") {
        if let Some(url) = destination {
            window.navigate(url)?;
        }
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }

    let opener = app.clone();
    let popup_opener = app.clone();
    let allowed = hosted_origin();
    let url = destination.unwrap_or_else(|| hosted_url("/workspace"));
    WebviewWindowBuilder::new(app, "cloud", WebviewUrl::External(url))
        .title("Lekhan Cloud")
        .inner_size(1160.0, 820.0)
        .min_inner_size(640.0, 500.0)
        .on_navigation(move |url| {
            if url.origin() == allowed.origin() {
                return true;
            }
            if url.scheme() == "https" {
                let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |url, _| {
            if url.scheme() == "https" {
                let _ = popup_opener.opener().open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

#[tauri::command]
async fn open_cloud_workspace(app: AppHandle) -> Result<(), String> {
    show_cloud(&app, None).map_err(|error| error.to_string())
}

fn handle_links(app: &AppHandle, links: &[Url]) {
    let Some(url) = links.iter().find_map(hosted_link) else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = show_cloud(&app, Some(url)) {
            eprintln!("Could not open the Lekhan link: {error}");
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("writer") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(vault::VaultState::default())
        .manage(local_models::LocalModels::default())
        .invoke_handler(tauri::generate_handler![
            open_cloud_workspace,
            vault::restore_vault,
            vault::choose_vault,
            vault::read_vault,
            vault::vault_sequence,
            vault::write_vault,
            vault::attachments::read_vault_attachment,
            vault::attachments::attach_vault_file,
            local_models::list_local_models,
            local_models::download_local_model,
            local_models::pause_model_download,
            local_models::discard_model_download,
            local_models::import_local_model,
            local_models::remove_local_model,
            local_models::generate_local_reply,
            local_models::cancel_local_reply,
        ])
        .setup(|app| {
            let opener = app.handle().clone();
            let popup_opener = app.handle().clone();
            WebviewWindowBuilder::new(app, "writer", WebviewUrl::App("index.html".into()))
                .title("Lekhan")
                .inner_size(1220.0, 840.0)
                .min_inner_size(520.0, 480.0)
                .on_navigation(move |url| {
                    if is_writer_url(url) {
                        return true;
                    }
                    if url.scheme() == "https" {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .on_new_window(move |url, _| {
                    if url.scheme() == "https" {
                        let _ = popup_opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;

            if let Some(links) = app.deep_link().get_current()? {
                handle_links(app.handle(), &links);
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                handle_links(&handle, &event.urls());
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Lekhan Desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<local_models::LocalModels>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_known_hosted_routes() {
        let accepted = hosted_link(&Url::parse("lekhan://open/workspace").unwrap()).unwrap();
        assert_eq!(accepted.origin(), hosted_origin().origin());
        assert_eq!(accepted.path(), "/workspace");
        assert!(
            hosted_link(
                &Url::parse("lekhan://open/page/a7aa2b2b-d994-473e-b786-6af810110011").unwrap()
            )
            .is_some()
        );
        for blocked in [
            "lekhan://open//outside.example",
            "lekhan://open/workspace?redirect=https://outside.example",
            "lekhan://open/workspace#secret",
            "lekhan://account@open/workspace",
            "lekhan://open:9000/workspace",
            "lekhan://wrong/workspace",
            "lekhan://open/page/not-an-id",
            "lekhan://open/auth/confirm",
        ] {
            assert!(
                hosted_link(&Url::parse(blocked).unwrap()).is_none(),
                "{blocked}"
            );
        }
    }

    #[test]
    fn accepts_https_and_local_development_origins() {
        assert!(parse_hosted_origin("https://www.lekhan.online").is_some());
        assert!(parse_hosted_origin("http://127.0.0.1:3195").is_some());
        assert!(parse_hosted_origin("http://outside.example").is_none());
        assert!(parse_hosted_origin("https://www.lekhan.online/workspace").is_none());
        assert!(parse_hosted_origin("https://user@www.lekhan.online/").is_none());
    }

    #[test]
    fn protects_the_bundled_writer_origin() {
        assert!(is_writer_url(
            &Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(is_writer_url(
            &Url::parse("https://tauri.localhost/index.html").unwrap()
        ));
        assert!(!is_writer_url(
            &Url::parse("https://lekhan.online/").unwrap()
        ));
        assert!(!is_writer_url(
            &Url::parse("http://127.0.0.1:3193/").unwrap()
        ));
        assert_eq!(
            is_writer_url(&Url::parse("http://127.0.0.1:3192/").unwrap()),
            cfg!(dev)
        );
    }
}
