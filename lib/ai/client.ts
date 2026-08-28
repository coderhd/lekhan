import { AIProviderConfig } from './types'
import { resolveChatRequest } from './provider-registry'

export interface StreamChatArgs {
	prompt: string
	systemPrompt?: string
	providerConfig: AIProviderConfig
	fallbackConfigs?: AIProviderConfig[]
	onChunk: (text: string) => void
	onDone: (stats: any) => void
	onError: (err: any) => void
	onFallback: (config: AIProviderConfig, reason: string) => void
}

export class AIClient {
	async streamChat(args: StreamChatArgs): Promise<{ unsubscribe: () => void }> {
		const { prompt, systemPrompt, providerConfig, fallbackConfigs, onChunk, onDone, onError, onFallback } = args
		const abortController = new AbortController()

		const attempt = async (config: AIProviderConfig, fallbacks: AIProviderConfig[]) => {
			try {
				const resolved = resolveChatRequest({
					provider: config.provider as any,
					model: config.defaultModel,
					messages: (() => {
						const msgs: Array<{ role: string; content: string }> = []
						if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
						msgs.push({ role: 'user', content: prompt })
						return msgs
					})(),
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
				})

				const url = resolved.url
				const headers = resolved.headers as Record<string, string>
				const body = resolved.body as Record<string, unknown>

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
									if (parsed.text) onChunk(parsed.text)
									if (parsed.message?.content) onChunk(parsed.message.content)
									if (parsed.choices?.[0]?.delta?.content) onChunk(parsed.choices[0].delta.content)
									if (parsed.choices?.[0]?.message?.content) onChunk(parsed.choices[0].message.content)
									if (parsed.candidates?.[0]?.content?.parts) {
										for (const part of parsed.candidates[0].content.parts) {
											if (part?.text) onChunk(part.text)
										}
									} else if (parsed.candidates?.[0]?.content?.parts === undefined && parsed.candidates?.[0]?.content) {
										// fallback: some Gemini payloads use candidates[0].content.parts or candidates[0].content.text
										const c = parsed.candidates[0].content as unknown as { text?: string }
										if (typeof c.text === 'string') onChunk(c.text)
									}
									if (parsed.totalTokens !== undefined) {
										lastStats = parsed
									}
								} catch {
									onChunk(dataStr)
								}
							} else if (trimmed && !trimmed.startsWith('event:')) {
								// Ollama NDJSON: {"message":{"content":" hi"},"done":false} or {"response":"..."}
								try {
									const parsed = JSON.parse(trimmed)
									if (parsed.message?.content) {
										onChunk(parsed.message.content)
									} else if (typeof parsed.response === 'string') {
										onChunk(parsed.response)
									} else if (parsed.choices?.[0]?.delta?.content) {
										onChunk(parsed.choices[0].delta.content)
									} else {
										onChunk(trimmed)
									}
								} catch {
									onChunk(trimmed)
								}
							}
						}
					}
					if (buffer.trim()) {
						onChunk(buffer.trim())
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
