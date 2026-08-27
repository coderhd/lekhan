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
			stream: true,
			temperature,
			maxTokens
		}

		if (provider === 'anthropic') {
			upstreamUrl = 'https://api.anthropic.com/v1/messages'
			upstreamHeaders['x-api-key'] = apiKey
			upstreamHeaders['anthropic-version'] = '2023-06-01'
		} else if (provider === 'gemini') {
			upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
			upstreamHeaders['x-goog-api-key'] = apiKey
			delete upstreamBody.stream
			delete upstreamBody.model
			upstreamBody = {
				contents: messages.map((m: any) => ({
					role: m.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: m.content }]
				}))
			}
		} else if (provider === 'sarvam') {
			upstreamUrl = baseUrl || 'https://api.sarvam.ai/v1/chat/completions'
			upstreamHeaders['api-subscription-key'] = apiKey
		} else {
			// openai, openrouter, groq, deepseek, qwen, zai
			let base = baseUrl
			if (!base) {
				if (provider === 'openai') base = 'https://api.openai.com/v1'
				else if (provider === 'openrouter') base = 'https://openrouter.ai/api/v1'
				else if (provider === 'groq') base = 'https://api.groq.com/openai/v1'
				else if (provider === 'deepseek') base = 'https://api.deepseek.com/v1'
				else if (provider === 'qwen') base = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
			}
			upstreamUrl = `${base}/chat/completions`
			upstreamHeaders['Authorization'] = `Bearer ${apiKey}`
		}

		const response = await fetch(upstreamUrl, {
			method: 'POST',
			headers: upstreamHeaders,
			body: JSON.stringify(upstreamBody)
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
