use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Url;
use uuid::Uuid;

const FLOW_LIFETIME: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub struct DesktopOAuth(Mutex<Option<(Uuid, Instant)>>);

fn single_parameter(url: &Url, name: &str) -> Option<String> {
    let mut matches = url.query_pairs().filter(|(key, _)| key == name);
    let value = matches.next()?.1.into_owned();
    matches.next().is_none().then_some(value)
}

fn nonce(url: &Url) -> Option<Uuid> {
    let id = single_parameter(url, "oauth")?;
    let nonce = Uuid::try_parse(&id).ok()?;
    (id.len() == 36 && nonce.get_version_num() == 4).then_some(nonce)
}

fn clean(url: &Url) -> bool {
    url.username().is_empty() && url.password().is_none() && url.fragment().is_none()
}

fn authorization_flow(url: &Url, hosted: &Url, auth_origin: Option<&Url>) -> Option<Uuid> {
    let trusted_origin = auth_origin.is_some_and(|origin| url.origin() == origin.origin())
        || auth_origin.is_none()
            && url.scheme() == "https"
            && url.port().is_none()
            && url.host_str().is_some_and(|host| {
                host.strip_suffix(".supabase.co").is_some_and(|project| {
                    !project.is_empty()
                        && project.bytes().all(|byte| {
                            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
                        })
                })
            });
    if !trusted_origin
        || !clean(url)
        || url.path() != "/auth/v1/authorize"
        || single_parameter(url, "provider").as_deref() != Some("google")
        || !single_parameter(url, "code_challenge_method")
            .is_some_and(|method| method.eq_ignore_ascii_case("s256"))
        || !single_parameter(url, "code_challenge").is_some_and(|code| {
            code.len() == 43
                && code
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
    {
        return None;
    }
    let target = Url::parse(&single_parameter(url, "redirect_to")?).ok()?;
    if !clean(&target)
        || target.origin() != hosted.origin()
        || target.path() != "/auth/desktop-return"
        || target.query_pairs().count() != 1
    {
        return None;
    }
    nonce(&target)
}

impl DesktopOAuth {
    pub fn begin(&self, url: &Url, hosted: &Url, auth_origin: Option<&Url>) -> bool {
        let Some(flow) = authorization_flow(url, hosted, auth_origin) else {
            return false;
        };
        let Ok(mut pending) = self.0.lock() else {
            return false;
        };
        *pending = Some((flow, Instant::now()));
        true
    }

    pub fn finish(&self, link: &Url, hosted: &Url) -> Option<Url> {
        if link.scheme() != "lekhan"
            || link.host_str() != Some("auth")
            || link.path() != "/complete"
            || link.port().is_some()
            || !clean(link)
            || link.query_pairs().count() != 2
        {
            return None;
        }
        let flow = nonce(link)?;
        let code = single_parameter(link, "code").filter(|value| {
            !value.is_empty()
                && value.len() <= 256
                && value.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'~')
                })
        });
        if code.is_none() && single_parameter(link, "error").as_deref() != Some("oauth") {
            return None;
        }
        let mut pending = self.0.lock().ok()?;
        let (active, started) = (*pending)?;
        if started.elapsed() >= FLOW_LIFETIME {
            *pending = None;
            return None;
        }
        if active != flow {
            return None;
        }
        *pending = None;
        let mut destination = hosted.join("/auth/confirm").ok()?;
        destination
            .query_pairs_mut()
            .append_pair("oauth", &flow.to_string());
        if let Some(code) = code {
            destination.query_pairs_mut().append_pair("code", &code);
        }
        Some(destination)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW: &str = "a7aa2b2b-d994-473e-b786-6af810110011";
    const OTHER_FLOW: &str = "85fd0cb0-4cfb-4387-b240-22fee30ce85d";

    fn authorization(hosted: &Url) -> Url {
        let mut target = hosted.join("/auth/desktop-return").unwrap();
        target.query_pairs_mut().append_pair("oauth", FLOW);
        let mut start = Url::parse("https://fixture.supabase.co/auth/v1/authorize").unwrap();
        start
            .query_pairs_mut()
            .append_pair("provider", "google")
            .append_pair("code_challenge", &"a".repeat(43))
            .append_pair("code_challenge_method", "s256")
            .append_pair("redirect_to", target.as_str());
        start
    }

    fn return_link(nonce: &str) -> Url {
        Url::parse(&format!(
            "lekhan://auth/complete?oauth={nonce}&code=fixture-code"
        ))
        .unwrap()
    }

    #[test]
    fn matches_only_the_running_pkce_flow_and_consumes_it_once() {
        let hosted = Url::parse("https://lekhan.example").unwrap();
        let oauth = DesktopOAuth::default();
        assert!(oauth.finish(&return_link(FLOW), &hosted).is_none());
        assert!(oauth.begin(&authorization(&hosted), &hosted, None));
        assert!(oauth.finish(&return_link(OTHER_FLOW), &hosted).is_none());
        let result = oauth.finish(&return_link(FLOW), &hosted).unwrap();
        assert_eq!(result.path(), "/auth/confirm");
        assert_eq!(result.origin(), hosted.origin());
        assert_eq!(
            single_parameter(&result, "code").as_deref(),
            Some("fixture-code")
        );
        assert!(oauth.finish(&return_link(FLOW), &hosted).is_none());
    }

    #[test]
    fn rejects_off_origin_openers_duplicates_and_expired_callbacks() {
        let hosted = Url::parse("https://lekhan.example").unwrap();
        let oauth = DesktopOAuth::default();
        let mut start = authorization(&hosted);
        start.set_host(Some("fixture.supabase.co.example")).unwrap();
        assert!(!oauth.begin(&start, &hosted, None));
        let mut start = authorization(&hosted);
        start.query_pairs_mut().append_pair("provider", "google");
        assert!(!oauth.begin(&start, &hosted, None));
        assert!(oauth.begin(&authorization(&hosted), &hosted, None));
        let mut callback = return_link(FLOW);
        callback
            .query_pairs_mut()
            .append_pair("next", "https://somewhere.example");
        assert!(oauth.finish(&callback, &hosted).is_none());
        *oauth.0.lock().unwrap() = Some((
            Uuid::try_parse(FLOW).unwrap(),
            Instant::now() - FLOW_LIFETIME,
        ));
        assert!(oauth.finish(&return_link(FLOW), &hosted).is_none());
    }
}
