import { buildUpstreamRequest, isValidCustomUrl } from '@/lib/ai/provider-registry'

export async function POST(req: Request) {
	try {
		const body = await req.json()
		const { provider, model, baseUrl, messages, temperature, maxTokens } = body
		const apiKey = req.headers.get('x-ai-api-key') || body.apiKey || ''

		if (provider === 'custom' && (!baseUrl || !isValidCustomUrl(baseUrl))) {
			return new Response(
				JSON.stringify({ error: 'Invalid or disallowed custom baseUrl' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			)
		}

		const { upstreamUrl, upstreamHeaders, upstreamBody } = buildUpstreamRequest({
			provider,
			model,
			messages,
			apiKey,
			baseUrl,
			temperature,
			maxTokens,
		})

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
