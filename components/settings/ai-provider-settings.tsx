import React, { useState, useEffect, useMemo } from 'react'
import { Activity, Eye, EyeOff, CheckCircle2, AlertTriangle, ChevronDown, Cpu, Loader2 } from 'lucide-react'
import { AIRegistryState, AIProviderType, ModelCard } from '../../lib/ai/types'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'
import { HardwareProfile, detectHardwareProfile } from '../../lib/ai/hardware'
import { LocalProbeResult, probeLocalRuntime } from '../../lib/ai/prober'
import { providerRegistry, isModelCompatible } from '../../lib/ai/provider-registry'
import { getHardwareRecommendation } from '../../lib/ai/hardware'
import styles from './ai-controls.module.css'
import { toast } from 'sonner'

interface AIProviderSettingsProps {
	children?: React.ReactNode
	registryState?: AIRegistryState
	onSaveRegistry?: (state: AIRegistryState) => Promise<void>
	user?: { id?: string; email?: string }
}

const BYOK_PROVIDERS: Array<{ id: AIProviderType; label: string; note?: string }> = [
	{ id: 'openai', label: 'OpenAI' },
	{ id: 'anthropic', label: 'Anthropic' },
	{ id: 'gemini', label: 'Google Gemini' },
	{ id: 'openrouter', label: 'OpenRouter', note: 'free tier' },
	{ id: 'groq', label: 'Groq', note: 'free tier' },
	{ id: 'deepseek', label: 'DeepSeek' },
	{ id: 'zai', label: 'Z.AI (GLM)', note: 'free tier' },
	{ id: 'qwen', label: 'Alibaba Qwen' },
	{ id: 'sarvam', label: 'Sarvam AI', note: 'Indic' },
	{ id: 'custom', label: 'Custom (OpenAI-compatible)' },
]

export function AIProviderSettings({ registryState, onSaveRegistry, children }: AIProviderSettingsProps) {
	const defaultState = useMemo(() => getDefaultAIRegistryState(), [])
	const state = registryState ?? defaultState
	const [hardware, setHardware] = useState<HardwareProfile | null>(null)
	const [localProbe, setLocalProbe] = useState<LocalProbeResult | null>(null)
	const [selectedProvider, setSelectedProvider] = useState<AIProviderType>(
		() => BYOK_PROVIDERS.find(provider => provider.id === state.activeProviderId)?.id ?? 'openai'
	)
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
	const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
	const [customBaseUrls, setCustomBaseUrls] = useState<Record<string, string>>({})
	const [testingKey, setTestingKey] = useState<Record<string, boolean>>({})
	const [isPingTesting, setIsPingTesting] = useState(false)
	const [pingResult, setPingResult] = useState<{ latencyMs?: number; success?: boolean } | null>(null)
	const [modelChoice, setModelChoice] = useState('')

	useEffect(() => {
		detectHardwareProfile().then(setHardware)
		probeLocalRuntime('ollama').then(setLocalProbe)
	}, [])

	useEffect(() => {
		const next: Record<string, string> = {}
		for (const [id, cfg] of Object.entries(state.providers)) {
			if (cfg.apiKey) next[id] = cfg.apiKey
		}
		setApiKeys(prev => {
			let changed = false
			const merged: Record<string, string> = { ...prev }
			for (const [k, v] of Object.entries(next)) {
				if (merged[k] !== v) { merged[k] = v; changed = true }
			}
			// also preserve existing prev keys not in next (dirty edits)
			return changed || Object.keys(merged).length !== Object.keys(prev).length ? merged : prev
		})
		const nextUrls: Record<string, string> = {}
		for (const [id, cfg] of Object.entries(state.providers)) {
			if (cfg.baseUrl) nextUrls[id] = cfg.baseUrl
		}
		if (Object.keys(nextUrls).length > 0) {
			setCustomBaseUrls(prev => {
				let changed = false
				const merged = { ...prev }
				for (const [k, v] of Object.entries(nextUrls)) if (merged[k] !== v) { merged[k] = v; changed = true }
				return changed ? merged : prev
			})
		}
	}, [state.providers])

	const handleKeyChange = (providerId: string, val: string) => setApiKeys(prev => ({ ...prev, [providerId]: val }))

	const handleSaveKey = async (providerId: string) => {
		const keyVal = (apiKeys[providerId] || '').trim()
		const baseUrlVal = (customBaseUrls[providerId] || '').trim()
		if (!onSaveRegistry) {
			toast.success(`Saved key for ${providerId} (local)`)
			return
		}
		const newState: AIRegistryState = structuredClone(state)
		if (!newState.providers[providerId]) {
			newState.providers[providerId] = {
				id: providerId,
				provider: providerId as AIProviderType,
				name: providerId,
				enabled: !!keyVal,
				defaultModel: state.activeModelId,
				availableModels: [state.activeModelId],
				apiKey: keyVal,
				baseUrl: baseUrlVal || undefined,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			}
		} else {
			newState.providers[providerId].apiKey = keyVal
			newState.providers[providerId].enabled = !!keyVal
			if (baseUrlVal) newState.providers[providerId].baseUrl = baseUrlVal
			else delete newState.providers[providerId].baseUrl
			newState.providers[providerId].updatedAt = new Date().toISOString()
		}
		await onSaveRegistry(newState)
		toast.success(keyVal ? `Saved key for ${providerId}` : `Cleared key for ${providerId}`)
	}

	const handleTestKey = async (providerId: string) => {
		const keyToTest = (apiKeys[providerId] || state.providers[providerId]?.apiKey || '').trim()
		const baseUrlToTest = (customBaseUrls[providerId] || state.providers[providerId]?.baseUrl || undefined)
		setTestingKey(prev => ({ ...prev, [providerId]: true }))
		try {
			const result = await providerRegistry.testConnection(providerId as AIProviderType, keyToTest, baseUrlToTest)
			if (result.success) toast.success(`Connected to ${providerId} — ${result.latencyMs}ms`)
			else toast.error(`Failed: ${result.error || 'Unknown'}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			toast.error(`Test error: ${msg}`)
		} finally {
			setTestingKey(prev => ({ ...prev, [providerId]: false }))
		}
	}

	const handleLivePing = async () => {
		setIsPingTesting(true)
		setPingResult(null)
		try {
			const providerId = (state.activeProviderId || 'openai') as AIProviderType
			const key = (apiKeys[providerId] || state.providers[providerId]?.apiKey || '').trim()
			const baseUrl = (customBaseUrls[providerId] || state.providers[providerId]?.baseUrl || undefined)
			const result = await providerRegistry.testConnection(providerId, key, baseUrl)
			setPingResult(result)
			if (result.success) toast.success(`Ping ${result.latencyMs}ms`)
			else toast.error(`Ping failed: ${result.error || 'Unreachable'}`)
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			toast.error(`Ping error: ${msg}`)
		} finally {
			setIsPingTesting(false)
		}
	}

	const handleSelectModel = (button: HTMLButtonElement, modelId: string, providerId: string) => {
		if (onSaveRegistry) {
			// Keep focus in the same model group when Active replaces its button.
			if (document.activeElement === button) button.parentElement?.focus()
			const newState = { ...state, activeModelId: modelId, activeProviderId: providerId }
			onSaveRegistry(newState)
			toast.success(`Active model: ${modelId}`)
		}
	}

	const models = providerRegistry.catalog as ModelCard[]
	const optionKey = (model: ModelCard) => `${model.provider}:${model.id}`
	const activeModel = models.find(model => model.id === state.activeModelId && model.provider === state.activeProviderId)
	const selectedModel = models.find(model => optionKey(model) === modelChoice)
		?? activeModel
		?? models[0]

	const getDetectedPlatform = () => {
		if (typeof navigator === 'undefined') return 'macos'
		const ua = navigator.userAgent?.toLowerCase() || ''
		if (ua.includes('win')) return 'windows'
		if (ua.includes('linux')) return 'linux'
		return 'macos'
	}
	const platform = getDetectedPlatform()
	const corsCommand = localProbe?.osCommand[platform as keyof typeof localProbe.osCommand] || localProbe?.osCommand.macos || ''

	const hasKey = (id: string) => Boolean(state.providers[id]?.apiKey)
	const provider = BYOK_PROVIDERS.find(item => item.id === selectedProvider)!
	const providerName = (id: string) => BYOK_PROVIDERS.find(item => item.id === id)?.label ?? state.providers[id]?.name ?? id
	const selectedIsActive = selectedModel && selectedModel === activeModel

	return (
		<div className={styles.stack}>
			<section className={styles.summary}>
				<div>
					<p className={styles.hint}>Active model</p>
					<h3>{activeModel?.name ?? state.activeModelId}</h3>
					<p className={styles.hint}>{providerName(state.activeProviderId)}{pingResult?.success && ` · ${pingResult.latencyMs} ms`}</p>
				</div>
				<button className={styles.secondary} onClick={handleLivePing} disabled={isPingTesting}>
					{isPingTesting ? <Loader2 className="animate-spin" /> : <Activity />} Test active
				</button>
			</section>

			<section className={styles.section}>
				<h3>Providers &amp; Keys</h3>
				<label className={styles.field}>Provider
					<span className={styles.selectWrap}>
						<select value={selectedProvider} onChange={event => {
							setSelectedProvider(event.target.value as AIProviderType)
							setShowKeys({})
						}}>
							{BYOK_PROVIDERS.map(item => (
								<option key={item.id} value={item.id}>{item.label}{item.note && ` · ${item.note}`}{hasKey(item.id) && ' · Configured'}</option>
							))}
						</select>
						<ChevronDown aria-hidden="true" />
					</span>
				</label>
				{provider.id === 'custom' && (
					<label className={styles.field}>Custom base URL
						<input className={styles.input} placeholder="https://api.example.com/v1"
							value={customBaseUrls[provider.id] || ''}
							onChange={event => setCustomBaseUrls(prev => ({ ...prev, [provider.id]: event.target.value }))} />
					</label>
				)}
				<div className={styles.field}>
					<label htmlFor="provider-api-key">{provider.label} API key</label>
					<div className={styles.controlRow}>
						<div className={styles.secret}>
							<input id="provider-api-key" type={showKeys[provider.id] ? 'text' : 'password'} autoComplete="off"
								placeholder={`${provider.label} API key`} value={apiKeys[provider.id] || ''}
								onChange={event => handleKeyChange(provider.id, event.target.value)} />
							<button type="button" className={styles.eye} aria-label={`${showKeys[provider.id] ? 'Hide' : 'Show'} ${provider.label} API key`}
								onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}>
								{showKeys[provider.id] ? <EyeOff /> : <Eye />}
							</button>
						</div>
						<div className={styles.actions}>
							<button className={styles.secondary} disabled={testingKey[provider.id]} onClick={() => handleTestKey(provider.id)}>
								{testingKey[provider.id] ? 'Testing…' : 'Test'}
							</button>
							<button className={styles.primary} onClick={() => handleSaveKey(provider.id)}>Save</button>
						</div>
					</div>
				</div>
			</section>

			<section className={styles.section}>
				<h3>All models</h3>
				<label className={styles.field}>Model
					<span className={styles.selectWrap}>
						<select value={selectedModel ? optionKey(selectedModel) : ''} onChange={event => setModelChoice(event.target.value)}>
							{models.map(model => (
								<option key={optionKey(model)} value={optionKey(model)}>{model.name} · {providerName(model.provider)}</option>
							))}
						</select>
						<ChevronDown aria-hidden="true" />
					</span>
				</label>
				{selectedModel ? (
					<div className={styles.details} role="group" aria-label={selectedModel.name} tabIndex={-1}>
						<p className={styles.hint}>
							{(selectedModel.contextWindow / 1000).toLocaleString()}k context · {selectedModel.speedTokPerSec} tokens/s · {selectedModel.costTier} · {selectedModel.category} · {selectedModel.hardwareTier}
						</p>
						{hardware && selectedModel.costTier === 'local' && <p className={styles.hint}>{getHardwareRecommendation(hardware).badgeText}</p>}
						{!isModelCompatible(selectedModel, hardware) && <p className={styles.hint}>Heavy for this device</p>}
						{selectedModel.costTier !== 'local' && !hasKey(selectedModel.provider) && (
							<p className={styles.notice}><AlertTriangle aria-hidden="true" /> Add an API key for {providerName(selectedModel.provider)} to use this model.</p>
						)}
						{selectedIsActive
							? <span className={styles.status}><CheckCircle2 />Active</span>
							: <button className={styles.primary} onClick={event => handleSelectModel(event.currentTarget, selectedModel.id, selectedModel.provider)}>Use this model</button>}
					</div>
				) : <p className={styles.hint}>No models available.</p>}
			</section>

			{children}

			<section className={styles.section}>
				<div className={styles.sectionHeader}>
					<h3>Local models</h3>
					{localProbe && <span className={styles.hint}>{{ connected: 'Connected', cors_blocked: 'CORS blocked', offline: 'Offline' }[localProbe.status]}</span>}
				</div>
				{localProbe?.status === 'cors_blocked' && (
					<div className={styles.details}>
						<p className={styles.notice}><AlertTriangle /> Allow browser connections on {platform}</p>
						<code className={styles.command}>{corsCommand}</code>
					</div>
				)}
				{localProbe?.models.length ? localProbe.models.map(model => (
					<div key={model} className={styles.sectionHeader} role="group" aria-label={model} tabIndex={-1}>
						<span>{model}</span>
						{model === state.activeModelId && state.activeProviderId === 'ollama'
							? <span className={styles.status}><CheckCircle2 />Active</span>
							: <button className={styles.secondary} onClick={event => handleSelectModel(event.currentTarget, model, 'ollama')}>Use</button>}
					</div>
				)) : <p className={styles.hint}>{localProbe ? 'No local models detected. Start Ollama and pull a model, then refresh.' : 'Checking for local models…'}</p>}
				{hardware && (
					<div className={styles.hardware}>
						<Cpu aria-hidden="true" />
						<div>
							<strong>Hardware · {hardware.label}</strong>
							<p className={styles.hint}>{hardware.ramGb} GB · {hardware.cpuCores} cores{hardware.hasWebGPU && ' · WebGPU'} · {hardware.recommendedMaxLocalModelSize}</p>
						</div>
					</div>
				)}
			</section>
		</div>
	)
}
