import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopProviderTransport } from '../../desktop/provider-transport'
import { probeLocalProviders, streamChat } from '../../lib/ai/client'
import { runFallback } from '../../lib/ai/fallback'

type Event = { type: 'head'; status: number } | { type: 'chunk'; data: string }
type TauriArgs = { requestId: string; request: { url: string; provider: string; headers: Record<string, string>; body?: string };
  output: { onmessage: (event: Event) => void } }
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class { constructor(readonly onmessage: (event: Event) => void) {} },
}))

const messages = [{ role: 'user', content: 'Selection only.' }] as const
const sse = (text: string) => Buffer.from(
  'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n',
).toString('base64')
const config = { id: 'local', provider: 'lmstudio' as const, model: 'fixture', apiKey: 'fixture-key' }

afterEach(() => {
  invoke.mockReset()
  vi.unstubAllGlobals()
})

describe('native provider transport', () => {
  it('uses the provider adapter and IPC without browser fetch or CORS', async () => {
    const browserFetch = vi.fn()
    vi.stubGlobal('fetch', browserFetch)
    invoke.mockImplementation(async (_command, args: TauriArgs) => {
      args.output.onmessage({ type: 'head', status: 200 })
      args.output.onmessage({ type: 'chunk', data: sse('Native reply.') })
    })
    await expect(streamChat(config, { messages }, desktopProviderTransport)).resolves.toEqual({ text: 'Native reply.' })
    expect(browserFetch).not.toHaveBeenCalled()
    const call = invoke.mock.calls[0]
    expect(call[0]).toBe('stream_provider_request')
    expect(call[1].request).toMatchObject({ provider: 'lmstudio', url: 'http://localhost:1234/v1/chat/completions', headers: { Authorization: 'Bearer fixture-key' } })
    expect(JSON.parse(call[1].request.body).messages).toEqual(messages)
  })

  it('preserves status for the configured fallback chain', async () => {
    invoke.mockImplementation(async (_command, args: TauriArgs) => {
      if (args.request.provider === 'lmstudio') {
        args.output.onmessage({ type: 'head', status: 503 })
        return
      }
      args.output.onmessage({ type: 'head', status: 200 })
      args.output.onmessage({ type: 'chunk', data: sse('Fallback reply.') })
    })
    const primary = { id: 'first', label: 'LM Studio', send: () => streamChat(config, { messages }, desktopProviderTransport) }
    const next = { id: 'second', label: 'llama.cpp', send: () => streamChat({ ...config, provider: 'llamacpp' }, { messages }, desktopProviderTransport) }
    await expect(runFallback(primary, [next], { messages })).resolves.toMatchObject({ text: 'Fallback reply.', route: next })
    expect(invoke.mock.calls.filter(([command]) => command === 'stream_provider_request')).toHaveLength(2)
  })

  it('cancels the same native request after the first text packet', async () => {
    const controller = new AbortController()
    let requestId: string | undefined
    invoke.mockImplementation((command, args: TauriArgs) => {
      if (command === 'cancel_provider_request') return Promise.resolve()
      requestId = args.requestId
      args.output.onmessage({ type: 'head', status: 200 })
      args.output.onmessage({ type: 'chunk', data: sse('Partial reply.') })
      return new Promise(() => {})
    })
    await expect(streamChat(config, {
      messages, signal: controller.signal,
      onText() { controller.abort() },
    }, desktopProviderTransport)).rejects.toThrow(/cancelled/i)
    expect(invoke).toHaveBeenCalledWith('cancel_provider_request', { requestId })
  })

  it('probes native endpoints without attempting a browser CORS fallback', async () => {
    const browserFetch = vi.fn()
    vi.stubGlobal('fetch', browserFetch)
    invoke.mockImplementation(async (_command, args: TauriArgs) => {
      if (args.request.provider === 'ollama') {
        args.output.onmessage({ type: 'head', status: 200 })
        args.output.onmessage({ type: 'chunk', data: Buffer.from('{"models":[{"name":"fixture-ollama"}]}').toString('base64') })
        return
      }
      throw 'network'
    })
    await expect(probeLocalProviders({ transport: desktopProviderTransport })).resolves.toMatchObject([
      { status: 'connected', models: ['fixture-ollama'] }, { status: 'offline' }, { status: 'offline' },
    ])
    expect(browserFetch).not.toHaveBeenCalled()
  })
})
