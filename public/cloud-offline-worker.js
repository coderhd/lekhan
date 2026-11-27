const cloudShell = '/cloud-offline'
const notebookShell = '/workspace-offline'
const cacheName = 'lekhan-offline-shell-v3'
const cacheKey = path => path + '?cached-shell'
let warmup = null
let refreshed = 0

function assetsIn(source, base) {
  const candidates = [...source.matchAll(/(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g)]
  return candidates.map(match => new URL(match[1] || match[2], base))
    .filter(url => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'))
    .map(url => url.href)
}

async function fetchAsset(cache, href) {
  const saved = await cache.match(href)
  if (saved) return saved
  const asset = await fetch(href, { credentials: 'omit', redirect: 'error' })
  if (!asset.ok) throw new Error('Offline editor asset unavailable.')
  await cache.put(href, asset.clone())
  return asset
}

async function prepareShell(path, assetFor) {
  const page = await fetch(path, { credentials: 'omit', cache: 'no-store', redirect: 'error' })
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Offline editor unavailable.')
  const assets = new Set(assetsIn(await page.clone().text(), page.url))
  if (![...assets].some(url => new URL(url).pathname.endsWith('.js'))) throw new Error('Offline editor has no runtime.')
  const styles = await Promise.all([...assets].map(async href => {
    const asset = await assetFor(href)
    return new URL(href).pathname.endsWith('.css') ? assetsIn(await asset.clone().text(), href) : []
  }))
  for (const href of styles.flat()) assets.add(href)
  await Promise.all(styles.flat().map(assetFor))
  return { page, assets }
}

async function prepare() {
  const cache = await caches.open(cacheName)
  const pending = new Map()
  const assetFor = href => {
    if (!pending.has(href)) pending.set(href, fetchAsset(cache, href))
    return pending.get(href)
  }
  const paths = [cloudShell, notebookShell]
  const shells = await Promise.all(paths.map(path => prepareShell(path, assetFor)))
  await Promise.all(shells.map(({ page }, index) => cache.put(cacheKey(paths[index]), page)))
  const urls = new Set(shells.flatMap(({ assets }) => [...assets]))
  refreshed = Date.now()
  const stale = (await cache.keys()).filter(request => new URL(request.url).pathname.startsWith('/_next/static/') && !urls.has(request.url))
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
  event.waitUntil(Promise.all([
    caches.delete('lekhan-cloud-shell-v1'),
    caches.delete('lekhan-offline-shell-v2'),
  ]).then(() => self.clients.claim()))
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
  const path = target.pathname.replace(/\/+$/, '') || '/'
  if (path === cloudShell || path === notebookShell) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(cacheKey(path))).then(saved => saved ?? fetch(request)))
    return
  }
  const id = /^\/(?:page|doc)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(path)?.[1]
  const shell = path === '/workspace' ? notebookShell : id || path === '/cloud' ? cloudShell : null
  if (!shell) return
  event.respondWith((async () => {
    let result
    try {
      result = await fetch(request, { signal: AbortSignal.timeout(5000) })
      if (result.status < 500) return result
    } catch {
      // Network failures fall back to the public shell. Authentication responses use the hosted route.
    }
    if (!await (await caches.open(cacheName)).match(cacheKey(shell))) return result ?? Response.error()
    const fallback = new URL(shell, target.origin)
    if (id) fallback.searchParams.set('page', id)
    if (target.hash) fallback.hash = target.hash
    return Response.redirect(fallback.href)
  })())
})
