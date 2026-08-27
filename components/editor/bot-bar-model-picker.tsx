import React, { useState, useRef, useEffect } from 'react'
import { Settings, Zap, ChevronDown } from 'lucide-react'

export interface BotBarModelPickerProps {
	activeModelId: string
	activeProvider: string
	onSelectModel: (modelId: string, providerId: string) => void
	onOpenSettings: () => void
	telemetry?: {
		totalTokens?: number
		latencyMs?: number
		speedTokPerSec?: number
	}
}

export function BotBarModelPicker({
	activeModelId,
	activeProvider,
	onSelectModel,
	onOpenSettings,
	telemetry,
}: BotBarModelPickerProps) {
	const [isOpen, setIsOpen] = useState(false)
	const popoverRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	const handleSelect = (modelId: string, providerId: string) => {
		onSelectModel(modelId, providerId)
		setIsOpen(false)
	}

	return (
		<div className="relative inline-flex items-center space-x-2" ref={popoverRef}>
			<button
				aria-label="Model picker"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center space-x-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 rounded-full text-sm font-medium transition-all duration-200"
			>
				<Zap className="w-4 h-4 text-yellow-400" />
				<span>{activeModelId} · {activeProvider}</span>
				<ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
			</button>

			{telemetry && (
				<div className="hidden sm:flex items-center space-x-1.5 px-2 py-1 bg-black/40 backdrop-blur-sm rounded-md text-xs font-mono text-gray-300">
					<span>Output:</span>
					{telemetry.totalTokens && <span>{telemetry.totalTokens} tok</span>}
					{telemetry.totalTokens && telemetry.latencyMs && <span>·</span>}
					{telemetry.latencyMs && <span>{telemetry.latencyMs} ms</span>}
				</div>
			)}

			{isOpen && (
				<div className="absolute top-full left-0 mt-2 w-64 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
					<div className="p-2 space-y-4">
						<div className="space-y-1">
							<div className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Free Presets</div>
							<button
								onClick={() => handleSelect('claude-3-5-sonnet', 'Anthropic')}
								className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg transition-colors"
							>
								Claude 3.5 Sonnet
							</button>
							<button
								onClick={() => handleSelect('gpt-4o', 'OpenAI')}
								className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg transition-colors"
							>
								GPT-4o
							</button>
						</div>

						<div className="space-y-1">
							<div className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Local</div>
							<button
								onClick={() => handleSelect('llama-3', 'Local')}
								className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg transition-colors"
							>
								Llama 3
							</button>
						</div>
						
						<div className="space-y-1">
							<div className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">BYOK</div>
							<button
								onClick={() => handleSelect('gemini-1.5-pro', 'Google')}
								className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/10 rounded-lg transition-colors"
							>
								Gemini 1.5 Pro
							</button>
						</div>
					</div>

					<div className="p-2 bg-black/40 border-t border-white/10">
						<button
							onClick={() => {
								onOpenSettings()
								setIsOpen(false)
							}}
							className="flex items-center justify-between w-full px-3 py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 rounded-lg transition-colors"
						>
							<span className="flex items-center gap-2">
								<Settings className="w-4 h-4" />
								Configure Providers & Keys ↗
							</span>
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
