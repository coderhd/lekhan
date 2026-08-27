export type ProbeStatus = 'connected' | 'cors_blocked' | 'offline'
export type LocalRuntime = 'ollama' | 'lmstudio' | 'llamacpp' | 'unknown'

export interface LocalProbeResult {
	status: ProbeStatus
	runtime: LocalRuntime
	port: number
	baseUrl: string
	models: string[]
	latencyMs: number
	osCommand: { macos: string; linux: string; windows: string }
	error?: string
}

export function getOsSpecificCorsCommand(runtime: LocalRuntime): { macos: string; linux: string; windows: string } {
	if (runtime === 'ollama') {
		return {
			macos: 'OLLAMA_ORIGINS="*" ollama serve',
			linux: 'OLLAMA_ORIGINS="*" ollama serve',
			windows: '$env:OLLAMA_ORIGINS="*" ; ollama serve'
		}
	}
	if (runtime === 'lmstudio') {
		return {
			macos: 'Enable CORS in LM Studio Settings -> Server -> Advanced',
			linux: 'Enable CORS in LM Studio Settings -> Server -> Advanced',
			windows: 'Enable CORS in LM Studio Settings -> Server -> Advanced'
		}
	}
	if (runtime === 'llamacpp') {
		return {
			macos: 'Start llama-server with --cors',
			linux: 'Start llama-server with --cors',
			windows: 'Start llama-server with --cors'
		}
	}
	return { macos: '', linux: '', windows: '' }
}

export async function probeLocalRuntime(runtime: LocalRuntime = 'ollama', customPort?: number): Promise<LocalProbeResult> {
	let port = 11434
	let endpoint = '/api/tags'

	if (runtime === 'lmstudio') {
		port = customPort || 1234
		endpoint = '/v1/models'
	} else if (runtime === 'llamacpp') {
		port = customPort || 8080
		endpoint = '/v1/models'
	} else if (runtime === 'ollama') {
		port = customPort || 11434
		endpoint = '/api/tags'
	} else {
		port = customPort || 80
		endpoint = '/'
	}

	const baseUrl = `http://127.0.0.1:${port}`
	const url = `${baseUrl}${endpoint}`
	const osCommand = getOsSpecificCorsCommand(runtime)

	const start = performance.now()
	try {
		// Use AbortSignal.timeout if available, otherwise just use fetch without it
		const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(3000) : undefined
		const response = await fetch(url, { signal })
		const latencyMs = performance.now() - start

		if (!response.ok) {
			return {
				status: 'offline',
				runtime,
				port,
				baseUrl,
				models: [],
				latencyMs,
				osCommand,
				error: `HTTP Error ${response.status}`
			}
		}

		const data = await response.json()
		let models: string[] = []
		if (runtime === 'ollama' && data.models) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			models = data.models.map((m: any) => m.name)
		} else if ((runtime === 'lmstudio' || runtime === 'llamacpp') && data.data) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			models = data.data.map((m: any) => m.id)
		}

		return {
			status: 'connected',
			runtime,
			port,
			baseUrl,
			models,
			latencyMs,
			osCommand
		}
	} catch (error: any) {
		const latencyMs = performance.now() - start
		
		if (error instanceof TypeError || error.name === 'TypeError' || error.message?.includes('Failed to fetch')) {
			return {
				status: 'cors_blocked',
				runtime,
				port,
				baseUrl,
				models: [],
				latencyMs,
				osCommand,
				error: error.message
			}
		}
		
		return {
			status: 'offline',
			runtime,
			port,
			baseUrl,
			models: [],
			latencyMs,
			osCommand,
			error: error.message
		}
	}
}

export async function probeAllLocalRuntimes(): Promise<LocalProbeResult[]> {
	return Promise.all([
		probeLocalRuntime('ollama'),
		probeLocalRuntime('lmstudio'),
		probeLocalRuntime('llamacpp')
	])
}
