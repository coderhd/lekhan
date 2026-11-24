const shellPath = '/cloud-offline'
const cacheName = 'lekhan-cloud-shell-v1'
const storedShell = '/cloud-offline?cached-shell'
let warmup = null
let refreshed = 0

function assetsIn(source, base) {
  const candidates = [...source.matchAll(/(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g)]
  return candidates.map(match => new URL(match[1] || match[2], base))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'))
    .map(url => url.href)
}

async function prepare() {
  const cache = await caches.open(cacheName)
  const page = await fetch(shellPath, { credentials: 'omit', cache: 'no-store', redirect: 'error' })
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Offline editor unavailable.')
  const assets = new Set(assetsIn(await page.clone().text(), page.url))
  if (![...assets].some(url => new URL(url).pathname.endsWith('.js'))) throw new Error('Offline editor has no runtime.')
  const styles = await Promise.all([...assets].map(async href => {
    const existing = await cache.match(href)
    const asset = existing ?? await fetch(href, { credentials: 'omit', redirect: 'error' })
    if (!asset.ok) throw new Error('Offline editor asset unavailable.')
    if (!existing) await cache.put(href, asset.clone())
    return new URL(href).pathname.endsWith('.css') ? assetsIn(await asset.text(), href) : []
  }))
  for (const href of new Set(styles.flat())) {
    assets.add(href)
    if (!await cache.match(href)) {
      const asset = await fetch(href, { credentials: 'omit', redirect: 'error' })
      if (!asset.ok) throw new Error('Offline editor font unavailable.')
      await cache.put(href, asset)
    }
  }
  await cache.put(storedShell, page)
  refreshed = Date.now()
  const stale = (await cache.keys()).filter(request => new URL(request.url).pathname.startsWith('/_next/static/') && !assets.has(request.url))
  await Promise.all(stale.map(request => cache.delete(request)))
}

function warm() {
  if (Date.now() - refreshed < 60_000) return Promise.resolve()
  if (!warmup) warmup = prepare().finally(() => { warmup = null })
  return warmup
}

self.addEventListener('install', event => {
  event.waitUntil(warm().then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', event => {
  if (event.data === 'prepare-cloud-offline') event.waitUntil(warm().catch(() => undefined))
})

self.addEventListener('fetch', event => {
  const request = event.request
  const target = new URL(request.url)
  if (request.method !== 'GET' || target.origin !== self.location.origin) return
  if (target.pathname.startsWith('/_next/static/')) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(request)).then(saved => saved ?? fetch(request)))
    return
  }
  if (request.mode !== 'navigate') return
  if (target.pathname === shellPath) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(storedShell)).then(saved => saved ?? fetch(request)))
    return
  }
  const id = /^\/page\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i.exec(target.pathname)?.[1]
  if (!id && target.pathname !== '/cloud') return
  event.respondWith((async () => {
    let result
    try {
      result = await fetch(request, { signal: AbortSignal.timeout(5000) })
      if (result.status < 500) return result
    } catch {
      // Network failures fall back to the public shell. Authentication responses use the hosted route.
    }
    if (!await (await caches.open(cacheName)).match(storedShell)) return result ?? Response.error()
    const fallback = new URL(shellPath, target.origin)
    if (id) fallback.searchParams.set('page', id)
    return Response.redirect(fallback.href)
  })())
})
