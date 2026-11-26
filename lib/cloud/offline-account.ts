export const offlineAccountCookie = 'lekhan-offline-account'
const accountId = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function authSessionCookie(url: string) {
  return 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token'
}

function cookieValues(header: string) {
  const cookies = new Map<string, string>()
  for (const entry of header.split(/;\s*/)) {
    const end = entry.indexOf('=')
    if (end > 0) cookies.set(entry.slice(0, end), entry.slice(end + 1))
  }
  return cookies
}

function decodeBase64Url(value: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), byte => byte.charCodeAt(0)))
}

// The hosted proxy sets the marker after validating claims. The browser checks
// continuity with the current cookie so an old marker cannot select another account.
export function offlineAccount(header: string, expectedCookie?: string) {
  try {
    const cookies = cookieValues(header)
    const [subject, name] = decodeURIComponent(cookies.get(offlineAccountCookie) ?? '').split(':')
    if (expectedCookie && name !== expectedCookie) return null
    if (!accountId.test(subject) || !/^sb-[a-z0-9-]+-auth-token$/i.test(name ?? '')) return null
    let raw = cookies.get(name) ?? ''
    if (!raw) {
      for (let part = 0; cookies.has(name + '.' + part); part++) raw += cookies.get(name + '.' + part)
    }
    raw = decodeURIComponent(raw)
    const session = JSON.parse(raw.startsWith('base64-') ? decodeBase64Url(raw.slice(7)) : raw)
    const payload = session?.access_token?.split('.')[1]
    if (!payload || JSON.parse(decodeBase64Url(payload)).sub !== subject) return null
    return subject
  } catch {
    return null
  }
}

export function offlineNotebookScope(header: string, sessionCookie?: string) {
  if (!sessionCookie) return 'personal'
  const cookies = cookieValues(header)
  if (!cookies.get(sessionCookie) && !cookies.get(sessionCookie + '.0')) return 'personal'
  const subject = offlineAccount(header, sessionCookie)
  return subject ? 'account:' + subject : null
}
