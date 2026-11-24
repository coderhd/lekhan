use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Manager, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct InstallLock(Mutex<()>);

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum UpdateStatus {
    Disabled,
    Current,
    Available { version: String },
}

fn secure_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn is_configured(app: &AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

async fn available_update(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater_builder()
        .timeout(Duration::from_secs(15))
        .configure_client(|client| {
            client.redirect(reqwest::redirect::Policy::custom(|attempt| {
                if secure_url(attempt.url()) && attempt.previous().len() < 5 {
                    attempt.follow()
                } else {
                    attempt.error("invalid update redirect")
                }
            }))
        })
        .build()
        .map_err(|_| "check_failed".to_owned())?
        .check()
        .await
        .map_err(|_| "check_failed".to_owned())
}

#[tauri::command]
pub async fn check_for_app_update(app: AppHandle) -> Result<UpdateStatus, String> {
    if !is_configured(&app) {
        return Ok(UpdateStatus::Disabled);
    }
    Ok(match available_update(&app).await? {
        Some(update) => UpdateStatus::Available {
            version: update.version,
        },
        None => UpdateStatus::Current,
    })
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    lock: State<'_, InstallLock>,
    version: String,
) -> Result<(), String> {
    if !is_configured(&app) {
        return Err("check_failed".into());
    }
    let _installing = lock.0.try_lock().map_err(|_| "installing".to_owned())?;
    if app.get_webview_window("cloud").is_some() {
        return Err("close_cloud".into());
    }
    let mut update = available_update(&app)
        .await?
        .filter(|release| release.version == version)
        .ok_or("version_changed")?;
    if !secure_url(&update.download_url) {
        return Err("install_failed".into());
    }
    update.timeout = Some(Duration::from_secs(600));
    let payload = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| "install_failed".to_owned())?;
    // The cloud window can open through a desktop link during download.
    if app.get_webview_window("cloud").is_some() {
        return Err("close_cloud".into());
    }
    app.state::<crate::local_models::LocalModels>().stop();
    update
        .install(payload)
        .map_err(|_| "install_failed".to_owned())?;
    #[cfg(not(windows))]
    app.restart();
    #[cfg(windows)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_transport_requires_clean_https() {
        assert!(secure_url(
            &Url::parse("https://releases.example/file?expires=123").unwrap()
        ));
        for url in [
            "http://localhost/artifact",
            "https://user@releases.example/artifact",
            "https://releases.example/file#private",
        ] {
            assert!(!secure_url(&Url::parse(url).unwrap()));
        }
    }
}
