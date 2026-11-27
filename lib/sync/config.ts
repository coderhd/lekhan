export function syncUrl() {
  const supplied = process.env.LEKHAN_SYNC_URL?.trim()
  if (!supplied) return null
  try {
    const url = new URL(supplied)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && local)) return null
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}
