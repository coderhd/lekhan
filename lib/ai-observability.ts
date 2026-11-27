import { PostHog } from 'posthog-node'

type AIMessage = {
	role: 'system' | 'user' | 'assistant'
	content: string
}

type AIGeneration = {
	distinctId: string
	traceId: string
	sessionId: string | null
	provider: string
	model: string
	input: AIMessage[]
	output: string
	latencyMs: number
	stream: boolean
	status?: number
}

let posthogClient: PostHog | null | undefined

function getPostHogClient(): PostHog | null {
	if (posthogClient !== undefined) return posthogClient

	const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
	const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
	if (!token || !host) {
		if (process.env.NODE_ENV !== 'production') {
			const missingVariable = token
				? 'NEXT_PUBLIC_POSTHOG_HOST'
				: 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'
			console.warn(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`)
		}
		posthogClient = null
		return posthogClient
	}

	posthogClient = new PostHog(token, {
		host,
		flushAt: 1,
		flushInterval: 0,
		requestTimeout: 2000,
		fetchRetryCount: 0,
		privacyMode: false,
		enableExceptionAutocapture: false,
	})
	return posthogClient
}

export async function captureAiGeneration(generation: AIGeneration): Promise<void> {
	try {
		const client = getPostHogClient()
		if (!client) return

		client.capture({
			distinctId: generation.distinctId,
			event: '$ai_generation',
			properties: {
				$ai_trace_id: generation.traceId,
				$ai_session_id: generation.sessionId,
				$ai_model: generation.model,
				$ai_provider: generation.provider,
				$ai_input: generation.input,
				$ai_output_choices: [{ role: 'assistant', content: generation.output }],
				$ai_latency: generation.latencyMs / 1000,
				$ai_stream: generation.stream,
				...(generation.status === undefined ? {} : { $ai_http_status: generation.status }),
			},
		})
		await client.flush().catch(() => {})
	} catch {
		// AI delivery must not affect a completed model response.
	}
}
