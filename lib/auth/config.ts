const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])

function configuredOrigin(value: string | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash || url.search || url.pathname !== '/') return null
    if (url.protocol !== 'https:' && (url.protocol !== 'http:' || !loopback.has(url.hostname))) return null
    return url.origin
  } catch {
    return null
  }
}

export function authConfig() {
  const url = configuredOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey || !/^sb_publishable_[a-z0-9_-]+$/i.test(publishableKey)) return null
  return { url, publishableKey }
}

export function siteOrigin() {
  return configuredOrigin(process.env.LEKHAN_PUBLIC_URL)
}

export function docsOrigin() {
  return configuredOrigin(process.env.NEXT_PUBLIC_DOCS_URL)
}

export function confirmationTarget(type: 'email' | 'recovery', invite?: string) {
  const origin = siteOrigin()
  if (!origin) return null
  const url = new URL('/auth/confirm', origin)
  if (type === 'recovery') url.searchParams.set('flow', 'recovery')
  else if (invite) url.searchParams.set('invite', invite)
  return url.toString()
}
