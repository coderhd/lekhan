import React, { useState, useEffect } from 'react'
import { Activity, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, CloudOff, KeyRound, Cpu } from 'lucide-react'
import { AIRegistryState } from '../../lib/ai/types'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'
import { HardwareProfile, detectHardwareProfile } from '../../lib/ai/hardware'
import { LocalProbeResult, probeLocalRuntime } from '../../lib/ai/prober'
import { ModelLibrary } from './model-library'
import { Button } from '../ui/button'

interface AIProviderSettingsProps {
	registryState?: AIRegistryState
	onSaveRegistry?: (state: AIRegistryState) => Promise<void>
	user?: { id?: string; email?: string }
}

export function AIProviderSettings({ registryState = getDefaultAIRegistryState(), onSaveRegistry }: AIProviderSettingsProps) {
	const [activeTier, setActiveTier] = useState<1 | 2 | 3 | 'catalog'>(3)
	const [hardware, setHardware] = useState<HardwareProfile | null>(null)
	const [localProbe, setLocalProbe] = useState<LocalProbeResult | null>(null)
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
	const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
	
	const state = registryState || getDefaultAIRegistryState()

	useEffect(() => {
		detectHardwareProfile().then(setHardware)
		probeLocalRuntime('ollama').then(setLocalProbe)
	}, [])

	const toggleKeyVisibility = (provider: string) => {
		setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }))
	}

	const handleKeyChange = (provider: string, val: string) => {
		setApiKeys(prev => ({ ...prev, [provider]: val }))
	}

	const handleSaveKey = async (provider: string) => {
		// Mock save to vault
		if (onSaveRegistry) {
			const newState = { ...state }
			if (newState.providers[provider]) {
				newState.providers[provider].apiKey = apiKeys[provider] || ''
				await onSaveRegistry(newState)
			}
		}
	}

	const handleSelectModel = (modelId: string, providerId: string) => {
		if (onSaveRegistry) {
			const newState = { ...state, activeModelId: modelId, activeProviderId: providerId }
			onSaveRegistry(newState)
		}
	}

	return (
		<div className="space-y-8 max-w-4xl w-full">
			{/* Hardware Status Banner */}
			{hardware && (
				<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-sm flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<div className="p-2 bg-primary/10 rounded-lg text-primary">
							<Cpu className="w-5 h-5" />
						</div>
						<div>
							<h3 className="font-bold text-sm text-on-surface">Hardware Status</h3>
							<p className="text-xs text-on-surface-variant flex items-center gap-2">
								<span>{hardware.ramGb} GB RAM</span>
								<span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20"></span>
								<span>{hardware.cpuCores} Cores</span>
								{hardware.hasWebGPU && (
									<>
										<span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20"></span>
										<span className="text-primary font-medium">WebGPU Active</span>
									</>
								)}
							</p>
						</div>
					</div>
					<div className="px-3 py-1.5 bg-black/5 dark:bg-white/5 rounded-lg text-xs font-semibold text-on-surface">
						{hardware.label}
					</div>
				</section>
			)}

			{/* Active Provider Hero Card */}
			<section className="bg-primary-container text-on-primary-container rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-md relative overflow-hidden">
				<div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
				<div className="z-10">
					<p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-2">Active AI Model</p>
					<h2 className="text-3xl font-display-lg mb-1">{state.activeModelId}</h2>
					<p className="text-sm opacity-90 capitalize">Provider: {state.activeProviderId}</p>
				</div>
				<div className="z-10 shrink-0">
					<Button className="bg-on-primary-container text-primary-container hover:bg-on-primary-container/90 font-bold px-6 py-5 rounded-xl shadow-lg flex items-center gap-2">
						<Activity className="w-4 h-4" /> Live Ping Test
					</Button>
				</div>
			</section>

			{/* Tier Navigation Tabs */}
			<div className="flex border-b border-black/10 dark:border-white/10 overflow-x-auto hide-scrollbar">
				<button 
					onClick={() => setActiveTier(1)}
					className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTier === 1 ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
				>
					Tier 1: Local Offline Hub
				</button>
				<button 
					onClick={() => setActiveTier(2)}
					className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTier === 2 ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
				>
					Tier 2: Free On-Ramp
				</button>
				<button 
					onClick={() => setActiveTier(3)}
					className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTier === 3 ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
				>
					Tier 3: Cloud BYOK
				</button>
				<button 
					onClick={() => setActiveTier('catalog')}
					className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${activeTier === 'catalog' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
				>
					Model Catalog
				</button>
			</div>

			{/* Tier Content */}
			<div className="min-h-[400px]">
				{activeTier === 1 && (
					<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
						<div className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 backdrop-blur-md shadow-sm">
							<div className="flex items-start justify-between mb-6">
								<div>
									<h3 className="text-xl font-display-md text-on-surface font-bold mb-1">Local Ollama Instance</h3>
									<p className="text-xs text-on-surface-variant">Run models completely offline and privately on your machine.</p>
								</div>
								{localProbe?.status === 'connected' && (
									<span className="px-3 py-1 bg-[#a0f399]/20 text-[#2db922] dark:text-[#a0f399] border border-[#a0f399]/50 rounded-full text-xs font-bold flex items-center gap-1.5">
										<CheckCircle2 className="w-3.5 h-3.5" /> Connected
									</span>
								)}
								{localProbe?.status === 'cors_blocked' && (
									<span className="px-3 py-1 bg-amber-500/20 text-amber-600 dark:text-amber-500 border border-amber-500/50 rounded-full text-xs font-bold flex items-center gap-1.5">
										<AlertTriangle className="w-3.5 h-3.5" /> CORS Blocked
									</span>
								)}
								{localProbe?.status === 'offline' && (
									<span className="px-3 py-1 bg-error/10 text-error border border-error/30 rounded-full text-xs font-bold flex items-center gap-1.5">
										<CloudOff className="w-3.5 h-3.5" /> Offline
									</span>
								)}
							</div>

							{localProbe?.status === 'cors_blocked' && (
								<div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
									<h4 className="text-amber-600 dark:text-amber-500 font-bold text-sm mb-2">Fix CORS Issue</h4>
									<p className="text-xs text-amber-600/80 dark:text-amber-500/80 mb-3">To allow Lekhan to connect to your local Ollama, you must start it with CORS allowed.</p>
									<code className="block w-full bg-black/10 dark:bg-black/50 p-3 rounded-lg text-xs font-mono text-on-surface break-all select-all">
										{localProbe.osCommand.macos}
									</code>
								</div>
							)}

							<div className="space-y-3">
								<h4 className="text-sm font-bold text-on-surface uppercase tracking-wider">Discovered Models</h4>
								{localProbe?.models && localProbe.models.length > 0 ? (
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
										{localProbe.models.map(model => (
											<div key={model} className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl flex items-center justify-between hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
												<span className="text-sm font-medium text-on-surface">{model}</span>
												<Button variant="secondary" size="sm" onClick={() => handleSelectModel(model, 'ollama')}>Select</Button>
											</div>
										))}
									</div>
								) : (
									<div className="p-6 text-center border border-dashed border-black/10 dark:border-white/10 rounded-xl text-on-surface-variant text-sm">
										No local models found or instance offline.
									</div>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTier === 2 && (
					<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{['Gemini 3.7 Flash', 'Groq Llama 4 Maverick', 'DeepSeek V4 Flash'].map(preset => (
								<div key={preset} className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-5 backdrop-blur-md shadow-sm">
									<h3 className="font-bold text-base text-on-surface mb-1">{preset}</h3>
									<p className="text-xs text-on-surface-variant mb-4">Fast, capable, and free API tier available.</p>
									<div className="space-y-3">
										<div className="relative">
											<KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
											<input 
												type={showKeys[preset] ? "text" : "password"}
												placeholder="API Key"
												value={apiKeys[preset] || ''}
												onChange={e => handleKeyChange(preset, e.target.value)}
												className="w-full pl-9 pr-10 py-2 bg-black/5 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:outline-none"
											/>
											<button onClick={() => toggleKeyVisibility(preset)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
												{showKeys[preset] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
											</button>
										</div>
										<div className="flex gap-2">
											<Button variant="secondary" className="w-full text-xs" onClick={() => handleSaveKey(preset)}>Save Key</Button>
											<Button variant="default" className="w-full text-xs">Test Key</Button>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{activeTier === 3 && (
					<div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
						<div className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 backdrop-blur-md shadow-sm">
							<div className="flex items-center gap-3 mb-6">
								<Lock className="w-5 h-5 text-primary" />
								<div>
									<h3 className="text-xl font-display-md text-on-surface font-bold">Cloud BYOK Vault</h3>
									<p className="text-xs text-on-surface-variant">Your keys are encrypted and stored locally on your device.</p>
								</div>
							</div>

							<div className="space-y-6">
								{['OpenAI', 'Anthropic', 'Google Gemini', 'DeepSeek', 'Sarvam'].map(provider => (
									<div key={provider} className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5">
										<div className="sm:w-1/3">
											<h4 className="font-bold text-sm text-on-surface">{provider}</h4>
										</div>
										<div className="flex-1 space-y-3">
											<div className="relative">
												<KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
												<input 
													type={showKeys[provider] ? "text" : "password"}
													placeholder={`${provider} API Key`}
													value={apiKeys[provider] || ''}
													onChange={e => handleKeyChange(provider, e.target.value)}
													className="w-full pl-9 pr-10 py-2.5 bg-white dark:bg-black/50 border border-black/10 dark:border-white/10 rounded-lg text-sm focus:ring-1 focus:ring-primary focus:outline-none"
												/>
												<button onClick={() => toggleKeyVisibility(provider)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
													{showKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
												</button>
											</div>
											<div className="flex gap-2 justify-end">
												<Button variant="secondary" size="sm" className="text-xs font-semibold">Test Connection</Button>
												<Button size="sm" className="text-xs font-semibold" onClick={() => handleSaveKey(provider)}>Save to Vault</Button>
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}

				{activeTier === 'catalog' && (
					<div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
						<ModelLibrary 
							activeModelId={state.activeModelId} 
							onSelectModel={handleSelectModel}
							hardwareProfile={hardware || undefined}
						/>
					</div>
				)}
			</div>
		</div>
	)
}
