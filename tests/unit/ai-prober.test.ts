import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
	probeLocalRuntime,
	probeAllLocalRuntimes,
	getOsSpecificCorsCommand
} from '../../lib/ai/prober'

describe('AI Prober', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		vi.stubGlobal('performance', { now: () => 100 })
	})

	describe('getOsSpecificCorsCommand', () => {
		it('returns correct commands for ollama', () => {
			const cmds = getOsSpecificCorsCommand('ollama')
			expect(cmds.macos).toBe('OLLAMA_ORIGINS="http://localhost:3000,https://lekhan.app,app://*" ollama serve')
			expect(cmds.linux).toBe('OLLAMA_ORIGINS="http://localhost:3000,https://lekhan.app,app://*" ollama serve')
			expect(cmds.windows).toBe('$env:OLLAMA_ORIGINS="http://localhost:3000,https://lekhan.app,app://*" ; ollama serve')
		})

		it('returns instructions for lmstudio', () => {
			const cmds = getOsSpecificCorsCommand('lmstudio')
			expect(cmds.macos).toContain('Enable CORS')
		})

		it('returns instructions for llamacpp', () => {
			const cmds = getOsSpecificCorsCommand('llamacpp')
			expect(cmds.macos).toContain('--cors')
		})
	})

	describe('probeLocalRuntime', () => {
		it('detects connected ollama', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ models: [{ name: 'llama2' }, { name: 'mistral' }] })
			}))
			vi.stubGlobal('performance', { now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(150) })

			const result = await probeLocalRuntime('ollama')
			
			expect(result.status).toBe('connected')
			expect(result.runtime).toBe('ollama')
			expect(result.port).toBe(11434)
			expect(result.models).toEqual(['llama2', 'mistral'])
			expect(result.latencyMs).toBe(50)
			expect(global.fetch).toHaveBeenCalledWith(
				'http://127.0.0.1:11434/api/tags',
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			)
		})

		it('detects connected lmstudio', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ data: [{ id: 'gpt-3.5' }] })
			}))
			vi.stubGlobal('performance', { now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(120) })

			const result = await probeLocalRuntime('lmstudio')
			
			expect(result.status).toBe('connected')
			expect(result.runtime).toBe('lmstudio')
			expect(result.port).toBe(1234)
			expect(result.models).toEqual(['gpt-3.5'])
			expect(result.latencyMs).toBe(20)
		})

		it('detects cors_blocked when fetch throws TypeError (typical browser CORS behavior)', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
			
			const result = await probeLocalRuntime('ollama')
			
			expect(result.status).toBe('cors_blocked')
			expect(result.error).toContain('Failed to fetch')
		})

		it('detects offline when fetch throws network error or timeout', async () => {
			const error = new Error('Connection refused')
			error.name = 'TimeoutError'
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
			
			const result = await probeLocalRuntime('ollama')
			
			expect(result.status).toBe('offline')
		})
	})

	describe('probeAllLocalRuntimes', () => {
		it('runs probes for all runtimes', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
			
			const results = await probeAllLocalRuntimes()
			
			expect(results).toHaveLength(3)
			expect(results.map(r => r.runtime)).toEqual(['ollama', 'lmstudio', 'llamacpp'])
		})
	})
})
