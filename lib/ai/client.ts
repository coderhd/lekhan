import { AIProviderConfig } from './types'

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
				let url = '/api/ai/stream'
				const body: any = {
					provider: config.provider,
					model: config.defaultModel,
					apiKey: config.apiKey,
					baseUrl: config.baseUrl,
					messages: []
				}

				if (systemPrompt) {
					body.messages.push({ role: 'system', content: systemPrompt })
				}
				body.messages.push({ role: 'user', content: prompt })

				const fetchOpts: RequestInit = {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					signal: abortController.signal
				}

				if (config.provider === 'ollama' || config.provider === 'lmstudio') {
					url = `${config.baseUrl || 'http://localhost:11434'}/api/chat`
					fetchOpts.body = JSON.stringify({
						model: config.defaultModel,
						messages: body.messages,
						stream: true
					})
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
									if (parsed.totalTokens !== undefined) onDone(parsed)
								} catch {
									onChunk(dataStr)
								}
							} else if (trimmed && !trimmed.startsWith('event:')) {
								onChunk(trimmed)
							}
						}
					}
					if (buffer.trim()) {
						onChunk(buffer.trim())
					}
				}
				onDone({ totalTokens: 0, latencyMs: 0, model: config.defaultModel })

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
