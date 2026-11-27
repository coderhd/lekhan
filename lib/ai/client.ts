import posthog from 'posthog-js'
import { AIProviderConfig } from './types'
import { resolveChatRequest } from './provider-registry'

export interface StreamChatArgs {
	prompt: string
	systemPrompt?: string
	providerConfig: AIProviderConfig
	aiSessionId?: string
	aiTraceId?: string
	fallbackConfigs?: AIProviderConfig[]
	onChunk: (text: string) => void
	onDone: (stats: any) => void
	onError: (err: any) => void
	onFallback: (config: AIProviderConfig, reason: string) => void
}

export class AIClient {
	async streamChat(args: StreamChatArgs): Promise<{ unsubscribe: () => void }> {
		const { prompt, systemPrompt, providerConfig, aiSessionId, aiTraceId, fallbackConfigs, onChunk, onDone, onError, onFallback } = args
		const abortController = new AbortController()
		const aiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
		if (systemPrompt) aiMessages.push({ role: 'system', content: systemPrompt })
		aiMessages.push({ role: 'user', content: prompt })

		const attempt = async (config: AIProviderConfig, fallbacks: AIProviderConfig[]) => {
			try {
				const resolved = resolveChatRequest({
					provider: config.provider as any,
					model: config.defaultModel,
					messages: aiMessages,
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
				})

				const url = resolved.url
				const headers = resolved.headers as Record<string, string>
				const body = resolved.body as Record<string, unknown>
				const startedAt = Date.now()
				let output = ''

				if (!resolved.isLocalDirect && aiSessionId && aiTraceId) {
					headers['x-posthog-session-id'] = aiSessionId
					headers['x-posthog-trace-id'] = aiTraceId
					headers['x-posthog-distinct-id'] = posthog.get_distinct_id()
				}

				const fetchOpts: RequestInit = {
					method: 'POST',
					headers,
					body: JSON.stringify(body),
					signal: abortController.signal
				}

				const res = await fetch(url, fetchOpts)

				if (res.status === 429 || res.status === 503) {
					if (fallbacks && fallbacks.length > 0) {
						const nextFallback = fallbacks[0]
						const remainingFallbacks = fallbacks.slice(1)
						onFallback(nextFallback, `HTTP ${res.status}`)
						return attempt(nextFallback, remainingFallbacks)
					} else {
						onError(new Error(`HTTP ${res.status}`))
						return
					}
				}

				if (!res.ok) {
					onError(new Error(`HTTP ${res.status}`))
					return
				}

				// Stream reader implementation
				const reader = res.body?.getReader()
				let lastStats: any = null

				if (reader) {
					const decoder = new TextDecoder()
					let buffer = ''
					const emitChunk = (chunk: string) => {
						output += chunk
						onChunk(chunk)
					}
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						const text = decoder.decode(value, { stream: true })
						buffer += text
						const lines = buffer.split('\n')
						buffer = lines.pop() || ''
						for (const line of lines) {
							const trimmed = line.trim()
							if (trimmed.startsWith('data: ')) {
								const dataStr = trimmed.slice(6)
								if (dataStr === '[DONE]') continue
								try {
									const parsed = JSON.parse(dataStr)
									if (parsed.text) emitChunk(parsed.text)
									if (parsed.message?.content) emitChunk(parsed.message.content)
									if (parsed.choices?.[0]?.delta?.content) emitChunk(parsed.choices[0].delta.content)
									if (parsed.choices?.[0]?.message?.content) emitChunk(parsed.choices[0].message.content)
									if (parsed.candidates?.[0]?.content?.parts) {
										for (const part of parsed.candidates[0].content.parts) {
											if (part?.text) emitChunk(part.text)
										}
									} else if (parsed.candidates?.[0]?.content?.parts === undefined && parsed.candidates?.[0]?.content) {
										const c = parsed.candidates[0].content as unknown as { text?: string }
										if (typeof c.text === 'string') emitChunk(c.text)
									}
									if (parsed.totalTokens !== undefined) lastStats = parsed
								} catch {
									emitChunk(dataStr)
								}
							} else if (trimmed && !trimmed.startsWith('event:')) {
								try {
									const parsed = JSON.parse(trimmed)
									if (parsed.message?.content) emitChunk(parsed.message.content)
									else if (typeof parsed.response === 'string') emitChunk(parsed.response)
									else if (parsed.choices?.[0]?.delta?.content) emitChunk(parsed.choices[0].delta.content)
									else emitChunk(trimmed)
								} catch {
									emitChunk(trimmed)
								}
							}
						}
					}
					if (buffer.trim()) emitChunk(buffer.trim())
				}
				if (resolved.isLocalDirect && aiSessionId && aiTraceId) {
					try {
						posthog.capture('$ai_generation', {
							$ai_trace_id: aiTraceId,
							$ai_session_id: aiSessionId,
							$ai_model: config.defaultModel,
							$ai_provider: config.provider,
							$ai_input: aiMessages,
							$ai_output_choices: [{ role: 'assistant', content: output }],
							$ai_latency: (Date.now() - startedAt) / 1000,
							$ai_stream: true,
						})
					} catch {
						// Analytics must not affect an already-completed local model response.
					}
				}
				onDone(lastStats || { totalTokens: 0, latencyMs: 0, model: config.defaultModel })

			} catch (err: any) {
				if (err.name === 'AbortError') return
				onError(err)
			}
		}

		await attempt(providerConfig, fallbackConfigs || [])

		return {
			unsubscribe: () => abortController.abort()
		}
	}
}
