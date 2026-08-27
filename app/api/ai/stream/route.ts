const TRUSTED_PROVIDER_BASE_URLS: Record<string, string> = {
	openai: 'https://api.openai.com/v1',
	openrouter: 'https://openrouter.ai/api/v1',
	groq: 'https://api.groq.com/openai/v1',
	deepseek: 'https://api.deepseek.com/v1',
	qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	zai: 'https://api.z.ai/v1',
	sarvam: 'https://api.sarvam.ai/v1'
}

function isValidCustomUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl)
		if (parsed.protocol === 'https:') {
			const hostname = parsed.hostname.toLowerCase()
			// Block loopback and link-local / metadata IPs in production remote URLs
			if (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '169.254.169.254' ||
				hostname.startsWith('10.') ||
				hostname.startsWith('192.168.') ||
				hostname.startsWith('172.16.') ||
				hostname.endsWith('.internal')
			) {
				return false
			}
			return true
		}
		if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
			return true // Allow local dev custom endpoints
		}
		return false
	} catch {
		return false
	}
}

export async function POST(req: Request) {
	try {
		const body = await req.json()
		const { provider, model, baseUrl, messages, temperature, maxTokens } = body
		const apiKey = req.headers.get('x-ai-api-key') || body.apiKey || ''

		let upstreamUrl = ''
		const upstreamHeaders: Record<string, string> = {
			'Content-Type': 'application/json'
		}
		let upstreamBody: any = {
			model,
			messages,
			stream: true
		}

		if (temperature !== undefined) upstreamBody.temperature = temperature
		if (maxTokens !== undefined) upstreamBody.max_tokens = maxTokens

		if (provider === 'anthropic') {
			upstreamUrl = 'https://api.anthropic.com/v1/messages'
			upstreamHeaders['x-api-key'] = apiKey
			upstreamHeaders['anthropic-version'] = '2023-06-01'
			upstreamBody.max_tokens = maxTokens || 4096
		} else if (provider === 'gemini') {
			upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
			upstreamHeaders['x-goog-api-key'] = apiKey
			delete upstreamBody.stream
			delete upstreamBody.model
			delete upstreamBody.max_tokens
			delete upstreamBody.temperature

			const generationConfig: Record<string, any> = {}
			if (temperature !== undefined) generationConfig.temperature = temperature
			if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens

			upstreamBody = {
				contents: messages.map((m: any) => ({
					role: m.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: m.content }]
				})),
				...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {})
			}
		} else if (provider === 'sarvam') {
			upstreamUrl = 'https://api.sarvam.ai/v1/chat/completions'
			upstreamHeaders['api-subscription-key'] = apiKey
		} else if (provider === 'custom') {
			if (!baseUrl || !isValidCustomUrl(baseUrl)) {
				return new Response(
					JSON.stringify({ error: 'Invalid or disallowed custom baseUrl' }),
					{ status: 400, headers: { 'Content-Type': 'application/json' } }
				)
			}
			let base = baseUrl
			if (base.endsWith('/')) base = base.slice(0, -1)
			upstreamUrl = `${base}/chat/completions`
			if (apiKey) upstreamHeaders['Authorization'] = `Bearer ${apiKey}`
		} else {
			// openai, openrouter, groq, deepseek, qwen, zai
			const base = TRUSTED_PROVIDER_BASE_URLS[provider] || 'https://api.openai.com/v1'
			upstreamUrl = `${base}/chat/completions`
			if (apiKey) upstreamHeaders['Authorization'] = `Bearer ${apiKey}`
		}

		const response = await fetch(upstreamUrl, {
			method: 'POST',
			headers: upstreamHeaders,
			body: JSON.stringify(upstreamBody),
			signal: req.signal
		})

		if (!response.ok) {
			return new Response(
				JSON.stringify({
					error: `Provider error: ${response.status}`,
					details: response.status === 401 ? 'Unauthorized: Invalid API Key' : 'Upstream failure'
				}),
				{
					status: response.status,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		}

		// Simply proxy the stream back for now
		return new Response(response.body, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		})
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err.message }), { status: 500 })
	}
}
