import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown) => void

function loadWorker({ cachedShells = new Set<string>(), fetchMock = vi.fn() }: {
  cachedShells?: Set<string>
  fetchMock?: ReturnType<typeof vi.fn>
}) {
  const listeners = new Map<string, Handler[]>()
  const deletedCaches: string[] = []
  const cacheStore = {
    match: vi.fn(async (key: string | { url: string }) => {
      const target = typeof key === 'string' ? key : key.url
      return cachedShells.has(target) ? new Response('<html>cached</html>', { status: 200 }) : undefined
    }),
    put: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  }
  const cachesMock = {
    open: vi.fn(async () => cacheStore),
    delete: vi.fn(async (name: string) => {
      deletedCaches.push(name)
      return true
    }),
  }
  const selfMock = {
    location: { origin: 'https://lekhan.example' },
    addEventListener: (type: string, handler: Handler) => {
      const current = listeners.get(type) ?? []
      current.push(handler)
      listeners.set(type, current)
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  }
  const redirectSpy = vi.fn((url: string) => new Response(null, { status: 302, headers: { Location: url } }))
  const source = readFileSync(join(process.cwd(), 'public/cloud-offline-worker.js'), 'utf8')
  const run = new Function('self', 'caches', 'fetch', 'Response', source)
  run(selfMock, cachesMock, fetchMock, { redirect: redirectSpy, error: () => new Response(null, { status: 500 }) })

  return { listeners, deletedCaches, redirectSpy }
}

function dispatchFetch(listeners: Map<string, Handler[]>, url: string, mode: RequestMode = 'navigate') {
  let promise: Promise<Response> | undefined
  const event = {
    request: { url, method: 'GET', mode },
    respondWith(response: Promise<Response>) {
      promise = response
    },
  }
  for (const handler of listeners.get('fetch') ?? []) handler(event)
  return promise
}

describe('cloud offline service worker', () => {
  it('clears prior offline shell caches on activate', async () => {
    const { listeners, deletedCaches } = loadWorker({})
    const waits: Promise<unknown>[] = []
    for (const handler of listeners.get('activate') ?? []) {
      handler({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    }
    await Promise.all(waits)
    expect(deletedCaches).toContain('lekhan-cloud-shell-v1')
    expect(deletedCaches).toContain('lekhan-offline-shell-v2')
  })

  it('routes offline workspace, cloud, page, and legacy doc navigations while preserving heading fragments', async () => {
    const id = '4dbc5892-753d-4be6-9d78-faaeb9bbd2d7'
    const fetchMock = vi.fn(async () => { throw new Error('offline') })
    const { listeners, redirectSpy } = loadWorker({
      cachedShells: new Set(['/cloud-offline?cached-shell', '/workspace-offline?cached-shell']),
      fetchMock,
    })

    const cases: [string, string][] = [
      ['https://lekhan.example/workspace', 'https://lekhan.example/workspace-offline'],
      ['https://lekhan.example/workspace/', 'https://lekhan.example/workspace-offline'],
      ['https://lekhan.example/cloud', 'https://lekhan.example/cloud-offline'],
      ['https://lekhan.example/cloud/', 'https://lekhan.example/cloud-offline'],
      [`https://lekhan.example/page/${id}#heading=Intro`, `https://lekhan.example/cloud-offline?page=${id}#heading=Intro`],
      [`https://lekhan.example/doc/${id}/#heading=Notes`, `https://lekhan.example/cloud-offline?page=${id}#heading=Notes`],
    ]

    for (const [input, expected] of cases) {
      const response = await dispatchFetch(listeners, input, 'navigate')
      expect(response).toBeDefined()
      expect(redirectSpy).toHaveBeenLastCalledWith(expected)
    }

    const cachedShell = await dispatchFetch(listeners, 'https://lekhan.example/cloud-offline?page=' + id, 'navigate')
    expect(cachedShell?.status).toBe(200)

    const nonNavigate = dispatchFetch(listeners, 'https://lekhan.example/page/' + id + '?_rsc=1', 'cors')
    expect(nonNavigate).toBeUndefined()
  })
})
