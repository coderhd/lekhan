import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeLocalProviders } from '../../lib/ai/client'
import { localCorsCommand } from '../../lib/ai/local-provider-setup'

afterEach(() => vi.unstubAllGlobals())

describe('local model diagnostics', () => {
  it('checks the three default endpoints and distinguishes CORS from an unreachable port', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, options) => {
      if (String(url).includes(':11434')) return Response.json({ models: [{ name: 'llama3.2:3b' }, { name: 'llama3.2:3b' }] })
      if (String(url).includes(':1234') && options?.mode === 'no-cors') return { type: 'opaque' } as Response
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(probeLocalProviders()).resolves.toMatchObject([
      { provider: 'ollama', status: 'connected', models: ['llama3.2:3b'], latencyMs: expect.any(Number) },
      { provider: 'lmstudio', status: 'cors_blocked' },
      { provider: 'llamacpp', status: 'offline' },
    ])
    expect([...new Set(fetch.mock.calls.map(([url]) => url))]).toEqual([
      'http://localhost:11434/api/tags', 'http://localhost:1234/v1/models', 'http://localhost:8080/v1/models',
    ])
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
      expect(options).toMatchObject(options?.mode === 'no-cors'
        ? { method: 'HEAD', redirect: 'follow' } : { method: 'GET', redirect: 'error' })
      expect(options?.body).toBeUndefined()
      expect(Object.keys(options?.headers ?? {})).toEqual([])
    }
  })

  it('keeps auth and invalid responses separate from CORS and shows an empty catalog as connected', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('secret', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ invalid: true }))
      .mockResolvedValueOnce(Response.json({ data: [] })))
    await expect(probeLocalProviders()).resolves.toMatchObject([
      { status: 'authorization_needed' }, { status: 'unexpected_response' }, { status: 'connected', models: [] },
    ])
  })

  it('does not re-probe after cancellation', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      controller.abort()
      throw new TypeError('abort')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(probeLocalProviders({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized catalog without dropping other probe results', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ models: [{ name: 'x'.repeat(512 * 1024) }] }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'model' }] }))
      .mockResolvedValueOnce(Response.json({ data: [] })))
    await expect(probeLocalProviders()).resolves.toMatchObject([
      { status: 'unexpected_response' }, { status: 'connected', models: ['model'] }, { status: 'connected', models: [] },
    ])
  })
})

describe('origin-scoped local setup', () => {
  const origin = 'https://www.lekhan.online'
  it('builds Ollama commands for all three platforms', () => {
    expect(localCorsCommand('ollama', origin, 'mac')).toBe("launchctl setenv OLLAMA_ORIGINS 'https://www.lekhan.online'")
    expect(localCorsCommand('ollama', origin, 'windows')).toBe("$env:OLLAMA_ORIGINS = 'https://www.lekhan.online'\nollama serve")
    expect(localCorsCommand('ollama', origin, 'linux')).toBe("OLLAMA_ORIGINS='https://www.lekhan.online' ollama serve")
  })

  it('declines opaque and malformed origins and emits scoped llama.cpp flags', () => {
    for (const input of ['null', "https://host' && echo x", 'https://host/path', '*']) {
      expect(localCorsCommand('ollama', input, 'linux')).toBeUndefined()
    }
    expect(localCorsCommand('llamacpp', 'http://localhost:3182', 'linux')).toBe('--cors-origins "http://localhost:3182"')
    expect(localCorsCommand('lmstudio', origin, 'linux')).toBeUndefined()
  })
})
