import { afterEach, describe, expect, it, vi } from 'vitest'
import { runFallback, type ModelRoute } from '../../lib/ai/fallback'
import { streamChat } from '../../lib/ai/client'
import { createProviderVault, unlockProviderVault } from '../../lib/ai/vault'

const messages = [{ role: 'user', content: 'Selected passage only.' }] as const
const config = (id: string, provider: 'openai' | 'groq' | 'openrouter') => ({ id, provider, model: 'test-model', apiKey: 'test-' + id })
function route(id: string, provider: 'openai' | 'groq' | 'openrouter'): ModelRoute {
  return { id, label: id, send: options => streamChat(config(id, provider), options) }
}

const success = () => new Response('data: {"choices":[{"delta":{"content":"result"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n\ndata: [DONE]\n\n')
afterEach(() => vi.unstubAllGlobals())

describe('ordered inference fallback', () => {
  it('advances on 429 and 503 and reports the model that finished', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(success())
    vi.stubGlobal('fetch', fetch)
    const onFallback = vi.fn()
    const onText = vi.fn()
    const primary = route('primary', 'openai')
    const second = route('second', 'groq')
    const third = route('third', 'openrouter')
    await expect(runFallback(primary, [primary, second, second, third], { messages, onText }, onFallback))
      .resolves.toEqual({ text: 'result', usage: { totalTokens: 9 }, route: third, elapsedMs: expect.any(Number) })
    expect(onFallback.mock.calls).toEqual([[second], [third]])
    expect(onText.mock.calls).toEqual([['result']])
    expect(fetch.mock.calls.map(([, request]) => (request?.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer test-primary', 'Bearer test-second', 'Bearer test-third'])
    expect(fetch.mock.calls.map(([, request]) => JSON.parse(request?.body as string).messages)).toEqual([messages, messages, messages])
  })

  it.each([401, 404, 500])('does not send the request elsewhere after HTTP %i', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status }))
    vi.stubGlobal('fetch', fetch)
    await expect(runFallback(route('primary', 'openai'), [route('secondary', 'groq')], { messages })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps a partial reply from being replaced by another model', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"status":503}}\n\n',
    ))
    vi.stubGlobal('fetch', fetch)
    const onText = vi.fn()
    await expect(runFallback(route('primary', 'openai'), [route('secondary', 'groq')], { messages, onText })).rejects.toThrow()
    expect(onText.mock.calls).toEqual([['partial']])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the configured on-device adapter without sending it through fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const device: ModelRoute = { id: 'device:installed', label: 'Installed GGUF', send: vi.fn(async () => ({ text: 'local reply' })) }
    await expect(runFallback(route('primary', 'openai'), [device], { messages }))
      .resolves.toMatchObject({ text: 'local reply', route: device })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(device.send).toHaveBeenCalledWith(expect.objectContaining({ messages }))
  })

  it('stops after the configured targets are exhausted', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('private first failure', { status: 429 }))
      .mockResolvedValueOnce(new Response('private second failure', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(runFallback(route('primary', 'openai'), [route('secondary', 'groq')], { messages }))
      .rejects.toMatchObject({ status: 503, message: 'The provider could not complete this request (HTTP 503).' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('cancels the chain before starting another provider', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    await expect(runFallback(route('primary', 'openai'), [route('secondary', 'groq')], { messages, signal: controller.signal },
      () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stores ordered route references inside the encrypted vault and reads earlier records', async () => {
    const primary = { ...config('primary', 'openai'), fallback: ['provider:second', 'device:third'] }
    const old = config('second', 'groq')
    const passphrase = 'fallback vault fixture'
    const vault = await createProviderVault(passphrase, [primary, old])
    const payload = await vault.seal()
    expect(payload).not.toContain('provider:second')
    const unlocked = await unlockProviderVault(passphrase, payload)
    expect(unlocked.configs).toEqual([primary, old])
  })
})
