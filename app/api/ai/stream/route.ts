import { captureAiGeneration } from '@/lib/ai-observability'
import { buildUpstreamRequest, isValidCustomUrl } from '@/lib/ai/provider-registry'

type AIMessage = {
	role: 'system' | 'user' | 'assistant'
	content: string
}

const AI_ID_PATTERN = /^[A-Za-z0-9\-_~.@()!':|]+$/

function extractStreamText(payload: unknown): string {
	if (!payload || typeof payload !== 'object') return ''
	const data = payload as {
		text?: unknown
		response?: unknown
		message?: { content?: unknown }
		choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>
		candidates?: Array<{ content?: { text?: unknown; parts?: Array<{ text?: unknown }> } }>
	}
	if (typeof data.text === 'string') return data.text
	if (typeof data.response === 'string') return data.response
	if (typeof data.message?.content === 'string') return data.message.content
	if (typeof data.choices?.[0]?.delta?.content === 'string') return data.choices[0].delta.content
	if (typeof data.choices?.[0]?.message?.content === 'string') return data.choices[0].message.content
	if (typeof data.candidates?.[0]?.content?.text === 'string') return data.candidates[0].content.text
	return data.candidates?.[0]?.content?.parts
		?.map(part => typeof part.text === 'string' ? part.text : '')
		.join('') || ''
}

function observedStream({
	body,
	distinctId,
	traceId,
	sessionId,
	provider,
	model,
	input,
	startedAt,
}: {
	body: ReadableStream<Uint8Array>
	distinctId: string
	traceId: string
	sessionId: string | null
	provider: string
	model: string
	input: AIMessage[]
	startedAt: number
}): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder()
	let pending = ''
	let output = ''
	const appendLine = (line: string) => {
		const value = line.trim().startsWith('data: ') ? line.trim().slice(6) : line.trim()
		if (!value || value === '[DONE]' || value.startsWith('event:')) return
		try {
			output += extractStreamText(JSON.parse(value))
		} catch {
			// Non-JSON keepalive messages contain no completion text.
		}
	}

	return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			controller.enqueue(chunk)
			pending += decoder.decode(chunk, { stream: true })
			const lines = pending.split('\n')
			pending = lines.pop() || ''
			for (const line of lines) appendLine(line)
		},
		async flush() {
			pending += decoder.decode()
			if (pending) appendLine(pending)
			await captureAiGeneration({
				distinctId,
				traceId,
				sessionId,
				provider,
				model,
				input,
				output,
				latencyMs: Date.now() - startedAt,
				stream: true,
				status: 200,
			})
		},
	}))
}

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

		const startedAt = Date.now()
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

		const distinctId = req.headers.get('x-posthog-distinct-id')
		const requestedSessionId = req.headers.get('x-posthog-session-id')
		const requestedTraceId = req.headers.get('x-posthog-trace-id')
		const input = Array.isArray(messages)
			? messages.filter((message: unknown): message is AIMessage => (
				Boolean(message) &&
				typeof message === 'object' &&
				['system', 'user', 'assistant'].includes((message as AIMessage).role) &&
				typeof (message as AIMessage).content === 'string'
			))
			: []
		const canObserve = Boolean(
			response.body &&
			distinctId &&
			requestedTraceId &&
			AI_ID_PATTERN.test(requestedTraceId) &&
			(!requestedSessionId || AI_ID_PATTERN.test(requestedSessionId))
		)
		const stream = canObserve && response.body && distinctId && requestedTraceId
			? observedStream({
				body: response.body,
				distinctId,
				traceId: requestedTraceId,
				sessionId: requestedSessionId || null,
				provider: typeof provider === 'string' ? provider : 'unknown',
				model: typeof model === 'string' ? model : 'unknown',
				input,
				startedAt,
			})
			: response.body

		return new Response(stream, {
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
