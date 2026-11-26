import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocalProviders, streamChat, testProviderConnection } from '../lib/ai/client'
import { FREE_PRESETS, type ProviderConfig } from '../lib/ai/provider-registry'

const messages = [{ role: 'user', content: 'Check this sentence.' }] as const

function config(provider: ProviderConfig['provider'], overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id: provider, provider, model: 'sample-model', apiKey: 'test-key', ...overrides }
}

function stream(parts: string[], contentType = 'text/event-stream') {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  }), { headers: { 'Content-Type': contentType } })
}

afterEach(() => vi.unstubAllGlobals())

describe('browser-direct inference', () => {
  it('uses the dedicated DeepSeek and Qwen chat routes with provider-scoped bearer keys', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      stream(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n', 'data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetch)
    const qwenBase = 'https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
    await expect(streamChat(config('deepseek', { model: 'deepseek-flash' }), { messages })).resolves.toMatchObject({ text: 'Hi' })
    await expect(streamChat(config('qwen', { model: 'qwen-plus', baseUrl: qwenBase }), { messages })).resolves.toMatchObject({ text: 'Hi' })
    const [[deepSeekUrl, deepSeekRequest], [qwenUrl, qwenRequest]] = fetch.mock.calls
    expect(String(deepSeekUrl)).toBe('https://api.deepseek.com/chat/completions')
    expect(String(qwenUrl)).toBe(qwenBase + '/chat/completions')
    expect(deepSeekRequest?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(qwenRequest?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse(String(deepSeekRequest?.body))).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' } })
    expect(JSON.parse(String(qwenRequest?.body))).toMatchObject({ model: 'qwen-plus', stream: true })
  })

  it('streams Mistral Small from Mistral Studio with the caller’s key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      stream(['data: {"choices":[{"delta":{"content":"Salut"}}]}\n\n', 'data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetch)
    await expect(streamChat(config('mistral', { model: 'mistral-small-2603' }), { messages }))
      .resolves.toMatchObject({ text: 'Salut' })
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
  })

  it('streams split SSE events and returns the usage reported by OpenAI', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      ': heartbeat\r\nda', 'ta: {"choices":[{"delta":{"content":"Hi"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    const onText = vi.fn()
    const result = await streamChat(config('openai'), { messages, onText, maxTokens: 128 })
    expect(result).toEqual({ text: 'Hi there', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } })
    expect(onText.mock.calls).toEqual([['Hi'], [' there']])
    const [url, request] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions')
    expect(request).toMatchObject({
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer test-key' },
    })
    expect(JSON.parse(String(request?.body))).toMatchObject({
      messages, stream: true, max_completion_tokens: 128, stream_options: { include_usage: true },
    })
    expect(request?.body).not.toContain('test-key')
  })

  it('sends native Anthropic messages and merges start and delta usage', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":8,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    const result = await streamChat(config('anthropic'), {
      messages: [{ role: 'system', content: 'Be brief.' }, ...messages],
    })
    expect(result).toEqual({ text: 'Hi', usage: { inputTokens: 8, outputTokens: 4 } })
    const [url, request] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages')
    expect(request?.headers).toMatchObject({
      'x-api-key': 'test-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(JSON.parse(String(request?.body))).toMatchObject({ messages, system: 'Be brief.', stream: true })
  })

  it('maps Gemini native roles, skips thinking content, and keeps its key out of the URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      'data: {"candidates":[{"content":{"parts":[{"text":"internal","thought":true},{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":1,"totalTokenCount":9}}\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    const result = await streamChat(config('gemini', { model: 'models/gemini-3.1-flash-lite' }), {
      messages: [{ role: 'assistant', content: 'Earlier' }, ...messages],
    })
    expect(result).toEqual({ text: 'Hi', usage: { inputTokens: 7, outputTokens: 1, totalTokens: 9 } })
    const [url, request] = fetch.mock.calls[0]
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse')
    expect(request?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' })
    expect(JSON.parse(String(request?.body)).contents).toEqual([
      { role: 'model', parts: [{ text: 'Earlier' }] },
      { role: 'user', parts: [{ text: 'Check this sentence.' }] },
    ])
  })

  it('streams Ollama native NDJSON and uses local token counters', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      '{"message":{"role":"assistant","content":"Hi"},"done":false}\n{"message":{"content":""}',
      ',"done":true,"prompt_eval_count":14,"eval_count":5}',
    ], 'application/x-ndjson'))
    vi.stubGlobal('fetch', fetch)
    const result = await streamChat(config('ollama', { apiKey: undefined }), { messages, maxTokens: 256 })
    expect(result).toEqual({ text: 'Hi', usage: { inputTokens: 14, outputTokens: 5 } })
    expect(String(fetch.mock.calls[0][0])).toBe('http://localhost:11434/api/chat')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ options: { num_predict: 256 } })
  })

  it('uses Sarvam’s compatible endpoint and subscription header', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    await expect(streamChat(config('sarvam'), { messages })).resolves.toEqual({ text: 'Hi' })
    expect(String(fetch.mock.calls[0][0])).toBe('https://api.sarvam.ai/v2/chat/completions')
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ 'api-subscription-key': 'test-key' })
  })

  it('preserves a custom versioned API path and rejects a cloud origin override', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => stream([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    await streamChat(config('custom', { baseUrl: 'https://models.example/api/v2/' }), { messages })
    expect(String(fetch.mock.calls[0][0])).toBe('https://models.example/api/v2/chat/completions')
    await expect(streamChat(config('openai', { baseUrl: 'https://models.example/v1' }), { messages })).rejects.toThrow(/default endpoint/i)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['http://models.example/v1', 'https://user:secret@models.example/v1', 'https://models.example?key=secret'])(
    'rejects unsafe custom base URLs before sending a request (%s)', async (baseUrl) => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(streamChat(config('custom', { baseUrl }), { messages })).rejects.toThrow(/endpoint/i)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('offers a quota recovery path without copying secrets from provider errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('test-key', {
      status: 429, statusText: 'test-key',
    }))
    vi.stubGlobal('fetch', fetch)
    const failure: Error = await streamChat(config('groq'), { messages }).catch((error) => error)
    expect(failure.message).toMatch(/rate limit|quota/i)
    expect(failure.message).not.toContain('test-key')
  })

  it('rejects truncated streams instead of treating partial text as a successful reply', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(stream([
      'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
    ]))
    vi.stubGlobal('fetch', fetch)
    await expect(streamChat(config('openai'), { messages })).rejects.toThrow(/ended early/i)
  })
})

describe('connection and discovery', () => {
  it('verifies a preset with a harmless generation rather than a public model list', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, options) => {
      expect(options?.method).toBe('POST')
      return stream(['data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'])
    })
    vi.stubGlobal('fetch', fetch)
    const preset = FREE_PRESETS[0]
    expect(preset).toMatchObject({ provider: 'openrouter', model: 'openrouter/free', verifiedDate: expect.any(String) })
    await expect(testProviderConnection(config(preset.provider, { model: preset.model }))).resolves.toMatchObject({
      models: ['openrouter/free'], latencyMs: expect.any(Number),
    })
  })

  it('identifies local services and gives browser CORS guidance on failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url) => {
      if (String(url) === 'http://localhost:11434/api/tags') {
        return Response.json({ models: [{ name: 'llama3.2:3b' }] })
      }
      if (String(url) === 'http://localhost:8080/v1/models') {
        return Response.json({ data: [{ id: 'local-gguf' }] })
      }
      throw new TypeError('browser fetch failed')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(detectLocalProviders()).resolves.toMatchObject([
      { provider: 'ollama', models: ['llama3.2:3b'] },
      { provider: 'llamacpp', models: ['local-gguf'] },
    ])
    fetch.mockRejectedValue(new TypeError('browser fetch failed'))
    await expect(testProviderConnection(config('ollama', { apiKey: undefined }))).rejects.toThrow(/OLLAMA_ORIGINS/)
  })
})
