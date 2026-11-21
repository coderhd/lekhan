import {
  endpointFor, LOCAL_PROVIDERS, localConnectionHelp, providerDefinition, type ProviderConfig, type ProviderId,
} from './provider-registry'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number }
type ChatOptions = {
  messages: readonly ChatMessage[]
  signal?: AbortSignal
  onText?: (text: string) => void
  maxTokens?: number
}

function headersFor(config: ProviderConfig): Record<string, string> {
  const key = config.apiKey?.trim()
  if (!key) {
    if (providerDefinition(config.provider).requiresKey) throw new Error('Add your provider API key before connecting.')
    return {}
  }
  if (/[\r\n]/.test(key)) throw new Error('The API key contains invalid characters.')
  if (config.provider === 'anthropic') return {
    'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (config.provider === 'gemini') return { 'x-goog-api-key': key }
  if (config.provider === 'sarvam') return { 'api-subscription-key': key }
  return { Authorization: 'Bearer ' + key }
}

function chatRequest(config: ProviderConfig, options: ChatOptions) {
  const endpoint = endpointFor(config)
  const model = config.model.trim()
  if (!model || model.length > 256) throw new Error('Choose a model before connecting.')
  const { messages, maxTokens } = options
  const { protocol } = providerDefinition(config.provider)
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const conversation = messages.filter(message => message.role !== 'system')

  if (protocol === 'ollama') return {
    url: endpoint + '/api/chat',
    body: { model, messages, stream: true, ...(maxTokens ? { options: { num_predict: maxTokens } } : {}) },
  }
  if (protocol === 'anthropic') return {
    url: endpoint + '/messages',
    body: { model, messages: conversation, stream: true, max_tokens: maxTokens ?? 4096, ...(system ? { system } : {}) },
  }
  if (protocol === 'gemini') return {
    url: endpoint + '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse',
    body: {
      contents: conversation.map(({ role, content }) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text: content }] })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}),
    },
  }
  const tokenField = config.provider === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }
  return {
    url: endpoint + '/chat/completions',
    body: {
      model, messages, stream: true, ...(maxTokens ? tokenField : {}),
      ...(config.provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
    },
  }
}

function requestSignal(signal: AbortSignal | undefined, timeout: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
}

async function fetchProvider(config: ProviderConfig, url: string, signal: AbortSignal, body?: unknown) {
  const headers = headersFor(config)
  let response: Response
  try {
    response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
      signal,
    })
  } catch {
    if (signal.aborted) throw new Error(signal.reason?.name === 'TimeoutError' ? 'The provider did not respond in time.' : 'The request was cancelled.')
    if (providerDefinition(config.provider).local) throw new Error(localConnectionHelp(config.provider))
    throw new Error('The browser could not reach this provider. Check your connection and whether the endpoint allows browser requests.')
  }
  if (response.ok) return response
  await response.body?.cancel().catch(() => undefined)
  if (response.status === 401 || response.status === 403) throw new Error('The provider rejected the API key or model access.')
  if (response.status === 429) throw new Error('The provider applied a rate limit or quota. Check your provider account or try again later.')
  if (response.status === 404) throw new Error('The model or provider endpoint was not found.')
  throw new Error('The provider could not complete this request (HTTP ' + response.status + ').')
}

async function* linesFrom(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      if (buffer.length > 2_000_000) throw new Error('The provider response exceeded the size limit.')
      if (done) {
        if (buffer) yield buffer
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function* packets(body: ReadableStream<Uint8Array>, ndjson: boolean) {
  let event = ''
  for await (const line of linesFrom(body)) {
    if (ndjson) {
      if (line.trim()) yield line
      continue
    }
    if (!line) {
      if (event) yield event
      event = ''
    } else if (line.startsWith('data:')) {
      event += (event ? '\n' : '') + line.slice(5).trimStart()
      if (event.length > 2_000_000) throw new Error('The provider response exceeded the size limit.')
    }
  }
  if (event) yield event
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function addUsage(next: Usage, values: [unknown, unknown, unknown]) {
  const labels = ['inputTokens', 'outputTokens', 'totalTokens'] as const
  for (const [index, value] of values.entries()) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next[labels[index]] = value
  }
}

export async function streamChat(config: ProviderConfig, options: ChatOptions): Promise<{ text: string; usage?: Usage }> {
  if (!options.messages.some(message => message.role === 'user')) throw new Error('Add a prompt before sending.')
  const request = chatRequest(config, options)
  const signal = requestSignal(options.signal, 120_000)
  const response = await fetchProvider(config, request.url, signal, request.body)
  if (!response.body) throw new Error('The provider returned an empty response.')
  const protocol = providerDefinition(config.provider).protocol
  const usage: Usage = {}
  let text = ''
  let complete = false

  try {
    for await (const packet of packets(response.body, protocol === 'ollama')) {
      if (packet === '[DONE]') {
        complete = true
        break
      }
      let data: Record<string, unknown>
      try { data = object(JSON.parse(packet)) } catch { throw new Error('The provider returned an unreadable event.') }
      if (data.error || data.type === 'error') throw new Error('The provider returned an error while responding.')
      let segment = ''

      if (protocol === 'anthropic') {
        const delta = object(data.delta)
        const stats = object(data.usage ?? object(data.message).usage)
        if (delta.type === 'text_delta') segment = textOf(delta.text)
        addUsage(usage, [stats.input_tokens, stats.output_tokens, undefined])
        complete ||= data.type === 'message_stop'
      } else if (protocol === 'gemini') {
        const choice = object(items(data.candidates)[0])
        const stats = object(data.usageMetadata)
        segment = items(object(choice.content).parts).map(object)
          .filter(part => !part.thought).map(part => textOf(part.text)).join('')
        addUsage(usage, [stats.promptTokenCount, stats.candidatesTokenCount, stats.totalTokenCount])
        complete ||= typeof choice.finishReason === 'string' || typeof stats.totalTokenCount === 'number'
      } else if (protocol === 'ollama') {
        segment = textOf(object(data.message).content)
        addUsage(usage, [data.prompt_eval_count, data.eval_count, undefined])
        complete ||= data.done === true
      } else {
        const choice = object(items(data.choices)[0])
        const stats = object(data.usage)
        segment = textOf(object(choice.delta).content)
        addUsage(usage, [stats.prompt_tokens, stats.completion_tokens, stats.total_tokens])
        complete ||= typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0
      }
      if (segment) {
        if (text.length + segment.length > 2_000_000) throw new Error('The provider response exceeded the size limit.')
        text += segment
        options.onText?.(segment)
      }
    }
    if (!complete) throw new Error('The provider stream ended early. Try again.')
  } catch (error) {
    if (signal.aborted) throw new Error(signal.reason?.name === 'TimeoutError' ? 'The provider did not respond in time.' : 'The request was cancelled.')
    throw error
  }

  return Object.keys(usage).length ? { text, usage } : { text }
}

export async function testProviderConnection(config: ProviderConfig, options: { signal?: AbortSignal } = {}) {
  const started = performance.now()
  if (!providerDefinition(config.provider).local) {
    const reply = await streamChat(config, {
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 128,
      signal: requestSignal(options.signal, 20_000),
    })
    if (!reply.text.trim()) throw new Error('The selected model returned no text.')
    return { models: [config.model], latencyMs: Math.round(performance.now() - started) }
  }

  const ollama = config.provider === 'ollama'
  const response = await fetchProvider(config, endpointFor(config) + (ollama ? '/api/tags' : '/models'), requestSignal(options.signal, 4_000))
  const catalog = object(await response.json())
  const models = items(ollama ? catalog.models : catalog.data).map(item => textOf(object(item)[ollama ? 'name' : 'id'])).filter(Boolean)
  if (!Array.isArray(ollama ? catalog.models : catalog.data)) throw new Error('This local endpoint did not return a model catalog.')
  return { models, latencyMs: Math.round(performance.now() - started) }
}

export async function detectLocalProviders({ signal }: { signal?: AbortSignal } = {}) {
  const candidates = await Promise.all(LOCAL_PROVIDERS.map(async (provider: ProviderId) => {
    const config = { id: provider, provider, model: '' }
    try {
      return { provider, baseUrl: endpointFor(config), ...await testProviderConnection(config, { signal }) }
    } catch {
      return null
    }
  }))
  return candidates.filter(candidate => candidate !== null)
}
