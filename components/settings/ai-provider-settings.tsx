import React, { useState, useEffect, useMemo } from 'react'
import { Activity, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, CloudOff, KeyRound, Cpu, Loader2, Search, Zap, DollarSign } from 'lucide-react'
import { AIRegistryState, AIProviderType, ModelCard } from '../../lib/ai/types'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'
import { HardwareProfile, detectHardwareProfile } from '../../lib/ai/hardware'
import { LocalProbeResult, probeLocalRuntime } from '../../lib/ai/prober'
import { providerRegistry, formatModelDescription, isModelCompatible } from '../../lib/ai/provider-registry'
import { getHardwareRecommendation } from '../../lib/ai/hardware'
import { Button } from '../ui/button'
import { toast } from 'sonner'

interface AIProviderSettingsProps {
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

export function AIProviderSettings({ registryState = getDefaultAIRegistryState(), onSaveRegistry }: AIProviderSettingsProps) {
	const [hardware, setHardware] = useState<HardwareProfile | null>(null)
	const [localProbe, setLocalProbe] = useState<LocalProbeResult | null>(null)
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
	const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
	const [testingKey, setTestingKey] = useState<Record<string, boolean>>({})
	const [isPingTesting, setIsPingTesting] = useState(false)
	const [pingResult, setPingResult] = useState<{ latencyMs?: number; success?: boolean } | null>(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [costFilter, setCostFilter] = useState<'all' | 'free' | 'local' | 'paid'>('all')
	const [categoryFilter, setCategoryFilter] = useState<'all' | 'general' | 'reasoning' | 'coding' | 'indic'>('all')

	const state = registryState || getDefaultAIRegistryState()

	useEffect(() => {
		detectHardwareProfile().then(setHardware)
		probeLocalRuntime('ollama').then(setLocalProbe)
	}, [])

	// Sync apiKeys from registry state (single source of truth)
	useEffect(() => {
		const next: Record<string, string> = {}
		for (const [id, cfg] of Object.entries(state.providers)) {
			if (cfg.apiKey) next[id] = cfg.apiKey
		}
		// merge with local edits — don't overwrite dirty keys
		setApiKeys(prev => ({ ...next, ...prev }))
		// only on registry change, keep existing unsaved edits? For simplicity, sync if empty
		if (Object.keys(next).length > 0) {
			setApiKeys(prev => {
				const merged: Record<string, string> = { ...prev }
				for (const [k, v] of Object.entries(next)) if (!merged[k]) merged[k] = v
				return merged
			})
		}
	}, [state.providers])

	const handleKeyChange = (providerId: string, val: string) => setApiKeys(prev => ({ ...prev, [providerId]: val }))

	const handleSaveKey = async (providerId: string) => {
		const keyVal = (apiKeys[providerId] || '').trim()
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
				enabled: true,
				defaultModel: state.activeModelId,
				availableModels: [state.activeModelId],
				apiKey: keyVal,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString()
			}
		} else {
			newState.providers[providerId].apiKey = keyVal
			newState.providers[providerId].enabled = !!keyVal
			newState.providers[providerId].updatedAt = new Date().toISOString()
		}
		await onSaveRegistry(newState)
		toast.success(keyVal ? `Saved key for ${providerId}` : `Cleared key for ${providerId}`)
	}

	const handleTestKey = async (providerId: string) => {
		const keyToTest = (apiKeys[providerId] || state.providers[providerId]?.apiKey || '').trim()
		setTestingKey(prev => ({ ...prev, [providerId]: true }))
		try {
			const result = await providerRegistry.testConnection(providerId as AIProviderType, keyToTest)
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
			const result = await providerRegistry.testConnection(providerId, key)
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

	const handleSelectModel = (modelId: string, providerId: string) => {
		if (onSaveRegistry) {
			const newState = { ...state, activeModelId: modelId, activeProviderId: providerId }
			onSaveRegistry(newState)
			toast.success(`Active model: ${modelId}`)
		}
	}

	const filteredModels = useMemo(() => {
		let list = providerRegistry.catalog as ModelCard[]
		if (costFilter !== 'all') list = list.filter(m => m.costTier === costFilter)
		if (categoryFilter !== 'all') list = list.filter(m => m.category === categoryFilter)
		if (searchQuery) {
			const q = searchQuery.toLowerCase()
			list = list.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || formatModelDescription(m).toLowerCase().includes(q))
		}
		return list
	}, [searchQuery, costFilter, categoryFilter])

	const getDetectedPlatform = () => {
		if (typeof navigator === 'undefined') return 'macos'
		const ua = navigator.userAgent?.toLowerCase() || ''
		if (ua.includes('win')) return 'windows'
		if (ua.includes('linux')) return 'linux'
		return 'macos'
	}
	const platform = getDetectedPlatform()
	const corsCommand = localProbe?.osCommand[platform as keyof typeof localProbe.osCommand] || localProbe?.osCommand.macos || ''

	const hasKey = (id: string) => !!(apiKeys[id] || state.providers[id]?.apiKey)

	return (
		<div className="space-y-6 max-w-5xl w-full">
			{/* Active model — compact hero, DESIGN.md teak accent */}
			<section className="rounded-2xl border border-black/5 dark:border-white/10 bg-primary-container text-on-primary-container p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
				<div className="min-w-0">
					<p className="text-[11px] font-bold uppercase tracking-widest opacity-70">Active model</p>
					<h2 className="text-xl font-bold tracking-tight truncate">{state.activeModelId}</h2>
					<p className="text-xs opacity-80 capitalize">Provider: {state.activeProviderId} {pingResult?.success ? `· ${pingResult.latencyMs}ms` : ''}</p>
				</div>
				<Button onClick={handleLivePing} disabled={isPingTesting} className="bg-[#191713] text-white hover:bg-black dark:bg-white dark:text-black font-semibold rounded-xl px-5 h-9 gap-2 shrink-0">
					{isPingTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Test active
				</Button>
			</section>

			{/* Hardware — compact */}
			{hardware && (
				<section className="rounded-xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-white/[0.04] backdrop-blur px-4 py-3 flex items-center justify-between gap-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<span className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/10 grid place-items-center"><Cpu className="w-4 h-4" /></span>
						<div className="min-w-0">
							<div className="text-xs font-semibold leading-none">Hardware · {hardware.label}</div>
							<div className="text-[11px] text-black/60 dark:text-white/60">{hardware.ramGb} GB · {hardware.cpuCores} cores {hardware.hasWebGPU ? '· WebGPU' : ''}</div>
						</div>
					</div>
					<span className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-black/5 dark:bg-white/10 shrink-0">{hardware.recommendedMaxLocalModelSize}</span>
				</section>
			)}

			{/* Local — compact card, not a tier */}
			<section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-4">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-bold flex items-center gap-2">Local models <span className="text-[11px] font-normal text-black/50 dark:text-white/50">BYOL · Ollama / LM Studio</span></h3>
					{localProbe?.status === 'connected' && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Connected</span>}
					{localProbe?.status === 'cors_blocked' && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-700 border border-amber-500/20 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> CORS</span>}
					{localProbe?.status === 'offline' && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-1"><CloudOff className="w-3 h-3" /> Offline</span>}
				</div>
				{localProbe?.status === 'cors_blocked' && (
					<div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
						<div className="text-xs font-semibold text-amber-800 dark:text-amber-200">Fix CORS — {platform}</div>
						<code className="mt-1 block rounded-lg bg-black/5 dark:bg-black/30 px-3 py-2 text-[11px] font-mono break-all select-all">{corsCommand}</code>
					</div>
				)}
				{localProbe?.models && localProbe.models.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{localProbe.models.map(m => (
							<span key={m} className="inline-flex items-center gap-2 rounded-full border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/5 px-3 py-1.5 text-xs">
								<span className="font-medium">{m}</span>
								<button onClick={() => handleSelectModel(m, 'ollama')} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#191713] text-white dark:bg-white dark:text-black">Use</button>
							</span>
						))}
					</div>
				) : (
					<p className="text-xs text-black/50 dark:text-white/50">No local models detected. Start Ollama and pull a model, then refresh.</p>
				)}
			</section>

			{/* Providers & Keys — unified, not per-tier */}
			<section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-4">
				<div className="flex items-center gap-2">
					<Lock className="w-4 h-4 text-black/60 dark:text-white/60" />
					<h3 className="text-sm font-bold">Providers & Keys</h3>
					<span className="text-[11px] text-black/50 dark:text-white/50">BYOK — keys stay encrypted on your device</span>
				</div>
				<div className="grid gap-3">
					{BYOK_PROVIDERS.map(p => {
						const configured = hasKey(p.id)
						return (
							<div key={p.id} className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border p-3 ${configured ? 'bg-emerald-500/[0.04] border-emerald-500/20' : 'bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10'}`}>
								<div className="sm:w-36 shrink-0 flex items-center gap-2">
									<span className={`w-2 h-2 rounded-full ${configured ? 'bg-emerald-500' : 'bg-black/20 dark:bg-white/20'}`} />
									<span className="text-xs font-semibold">{p.label}</span>
									{p.note && <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">{p.note}</span>}
								</div>
								<div className="flex-1 flex gap-2">
									<div className="relative flex-1">
										<KeyRound className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-black/30 dark:text-white/30" />
										<input
											type={showKeys[p.id] ? 'text' : 'password'}
											placeholder={`${p.label} API key`}
											value={apiKeys[p.id] || ''}
											onChange={e => handleKeyChange(p.id, e.target.value)}
											className="w-full pl-8 pr-8 py-2 rounded-lg bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
										/>
										<button type="button" aria-label={`Toggle ${p.label}`} onClick={() => setShowKeys(prev => ({ ...prev, [p.id]: !prev[p.id] }))} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
											{showKeys[p.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
										</button>
									</div>
									<Button variant="secondary" size="sm" disabled={!!testingKey[p.id]} onClick={() => handleTestKey(p.id)} className="h-8 text-xs px-3 shrink-0">{testingKey[p.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}</Button>
									<Button size="sm" onClick={() => handleSaveKey(p.id)} className="h-8 text-xs px-3 shrink-0 bg-[#191713] text-white dark:bg-white dark:text-black">{configured ? 'Save' : 'Save'}</Button>
								</div>
							</div>
						)
					})}
				</div>
				<p className="text-[11px] leading-4 text-black/50 dark:text-white/50">Free presets (Gemini, Groq, DeepSeek, Z.AI) work with any provider row above — paste a free-tier key and pick a free model below. Tauri #88 will add a Model Library built once against the local sidecar.</p>
			</section>

			{/* Unified model library — single filterable grid, replaces Tier 2/3/catalog tabs */}
			<section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-4">
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
					<h3 className="text-sm font-bold">All models</h3>
					<div className="relative w-full md:w-72">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-black/40 dark:text-white/40" />
						<input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search models, providers…" className="w-full pl-8 pr-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs focus:outline-none focus:ring-2 focus:ring-black/5" />
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<div className="flex rounded-lg bg-black/5 dark:bg-white/5 p-1 gap-1">
						{(['all','free','local','paid'] as const).map(v => (
							<button key={v} onClick={() => setCostFilter(v)} aria-pressed={costFilter===v} className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize ${costFilter===v ? 'bg-white dark:bg-white text-black shadow-sm' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'}`}>{v}</button>
						))}
					</div>
					<div className="flex rounded-lg bg-black/5 dark:bg-white/5 p-1 gap-1">
						{(['all','general','reasoning','coding','indic'] as const).map(v => (
							<button key={v} onClick={() => setCategoryFilter(v)} aria-pressed={categoryFilter===v} className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize ${categoryFilter===v ? 'bg-white dark:bg-white text-black shadow-sm' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'}`}>{v}</button>
						))}
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
					{filteredModels.map(model => {
						const isActive = state.activeModelId === model.id
						const hwBadge = hardware && model.costTier === 'local' ? (() => { const r = getHardwareRecommendation(hardware); return { text: r.badgeText, variant: r.badgeVariant } })() : null
						const compatible = isModelCompatible(model, hardware)
						const keyConfigured = hasKey(model.provider)
						const needsKey = model.costTier !== 'local' && !keyConfigured
						return (
							<div key={model.id} className={`rounded-2xl border p-4 flex flex-col gap-3 ${isActive ? 'border-black dark:border-white bg-black/[0.02] dark:bg-white/[0.06] ring-1 ring-black/5' : 'border-black/10 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'}`}>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<div className="text-sm font-semibold leading-none flex items-center gap-1.5 truncate">{model.name} {isActive && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}</div>
										<div className="text-[11px] leading-4 text-black/60 dark:text-white/60 mt-1 line-clamp-2">{formatModelDescription(model)}</div>
									</div>
									<span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-1 rounded bg-black/5 dark:bg-white/10">{model.provider}</span>
								</div>
								<div className="flex flex-wrap gap-1.5">
									<span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-black/5 dark:bg-white/10"><Cpu className="w-3 h-3" />{Math.round(model.contextWindow/1000)}k</span>
									<span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-black/5 dark:bg-white/10"><Zap className="w-3 h-3" />{model.speedTokPerSec} t/s</span>
									<span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ${model.costTier==='free' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : model.costTier==='local' ? 'bg-amber-500/10 text-amber-700' : 'bg-black/5 dark:bg-white/10'}`}><DollarSign className="w-3 h-3" />{model.costTier}</span>
									{hwBadge && <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${hwBadge.variant==='destructive' ? 'bg-red-500/10 text-red-600' : hwBadge.variant==='secondary' ? 'bg-amber-500/10 text-amber-700' : 'bg-black/5 dark:bg-white/10'}`}>{hwBadge.text}</span>}
									{!compatible && <span className="text-[11px] px-2 py-1 rounded-full bg-red-500/10 text-red-600">Heavy for this device</span>}
								</div>
								{needsKey && <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">Add a {model.provider} key above to use this model</div>}
								<Button variant={isActive ? 'secondary' : 'default'} className={`w-full h-8 text-xs font-semibold mt-auto ${isActive ? '' : 'bg-[#191713] text-white dark:bg-white dark:text-black hover:bg-black dark:hover:bg-white/90'}`} disabled={isActive} onClick={() => handleSelectModel(model.id, model.provider)}>{isActive ? 'Active' : 'Use this model'}</Button>
							</div>
						)
					})}
					{filteredModels.length===0 && <div className="col-span-full rounded-xl border border-dashed border-black/10 dark:border-white/10 p-8 text-center text-xs text-black/50 dark:text-white/50">No models match</div>}
				</div>
			</section>
		</div>
	)
}
