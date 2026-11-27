import type { BrowserContext } from '@playwright/test'

export const defaultSubject = '4dbc5892-753d-4be6-9d78-faaeb9bbd2d7'
export const defaultScope = 'account:' + defaultSubject
export const defaultVaultKey = 'lekhan:provider-vault:v1:' + defaultScope
export const defaultAuthOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:3183'
export const defaultBaseURL = 'http://localhost:3182'

export function authCookieName(authOrigin = defaultAuthOrigin) {
  return 'sb-' + new URL(authOrigin).hostname.split('.')[0] + '-auth-token'
}

export async function mintAuthCookies(baseURL = defaultBaseURL, options?: {
  subject?: string
  email?: string
  displayName?: string
  authOrigin?: string
}) {
  const authOrigin = options?.authOrigin ?? defaultAuthOrigin
  const subject = options?.subject ?? defaultSubject
  const email = options?.email ?? 'writer@lekhan.test'
  const displayName = options?.displayName ?? 'Lekhan Writer'
  const response = await fetch(`${authOrigin}/test/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject, email, displayName }),
  })
  if (!response.ok) throw new Error(`Auth fixture token request failed (${response.status}).`)
  const { access_token } = await response.json() as { access_token: string }
  const session = 'base64-' + Buffer.from(JSON.stringify({
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-refresh-token',
    user: { id: subject, aud: 'authenticated', role: 'authenticated', email, user_metadata: { full_name: displayName } },
  })).toString('base64url')
  const cookieName = authCookieName(authOrigin)
  const marker = encodeURIComponent(subject + ':' + cookieName)
  return [
    { name: 'lekhan-offline-account', value: marker, url: baseURL },
    { name: cookieName, value: encodeURIComponent(session), url: baseURL },
  ]
}

export async function signInContext(context: BrowserContext, baseURL = defaultBaseURL, options?: {
  subject?: string
  email?: string
  displayName?: string
  authOrigin?: string
}) {
  const cookies = await mintAuthCookies(baseURL, options)
  await context.addCookies(cookies)
  return cookies
}
