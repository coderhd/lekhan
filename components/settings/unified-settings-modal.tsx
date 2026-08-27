import React, { useState, useEffect } from 'react'
import { X, Bot, Settings, Paintbrush, CreditCard, Shield } from 'lucide-react'
import { AIProviderSettings } from './ai-provider-settings'
import { AIRegistryState } from '../../lib/ai/types'

interface UnifiedSettingsModalProps {
	isOpen: boolean
	onClose: () => void
	registryState?: AIRegistryState
	onSaveRegistry?: (state: AIRegistryState) => Promise<void>
	user?: { id?: string; email?: string }
}

const MODAL_TABS = [
	{ id: 'ai', label: 'AI & Models', icon: Bot },
	{ id: 'general', label: 'General & Profile', icon: Settings },
	{ id: 'editor', label: 'Editor & Preferences', icon: Paintbrush },
	{ id: 'plan', label: 'Plan & Usage', icon: CreditCard },
	{ id: 'privacy', label: 'Privacy & Vault', icon: Shield },
] as const

export function UnifiedSettingsModal({ isOpen, onClose, registryState, onSaveRegistry, user }: UnifiedSettingsModalProps) {
	const [activeTab, setActiveTab] = useState<'ai' | 'general' | 'editor' | 'plan' | 'privacy'>('ai')

	// Escape key dismissal
	useEffect(() => {
		if (!isOpen) return
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [isOpen, onClose])

	if (!isOpen) return null

	const handleTabKeyDown = (e: React.KeyboardEvent) => {
		const tabs = MODAL_TABS.map(t => t.id)
		const currentIndex = tabs.indexOf(activeTab)
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault()
			const nextIndex = (currentIndex + 1) % tabs.length
			setActiveTab(tabs[nextIndex])
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault()
			const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
			setActiveTab(tabs[prevIndex])
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-12 animate-in fade-in duration-200">
			{/* Backdrop */}
			<div 
				className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" 
				onClick={onClose}
				aria-hidden="true"
			/>
			
			{/* Modal Content */}
			<div 
				role="dialog" 
				aria-modal="true" 
				aria-labelledby="settings-modal-title"
				className="relative w-full max-w-5xl h-[85vh] bg-background border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in zoom-in-95 duration-200"
			>
				{/* Sidebar */}
				<div className="w-full md:w-64 bg-surface-container-low border-b md:border-b-0 md:border-r border-black/10 dark:border-white/10 flex flex-col shrink-0">
					<div className="p-6 pb-4">
						<h2 id="settings-modal-title" className="text-xl font-display-md font-bold text-on-surface">Workspace Settings</h2>
					</div>
					
					<nav 
						className="flex-1 overflow-y-auto px-4 pb-4 space-y-1" 
						role="tablist" 
						aria-orientation="vertical"
						onKeyDown={handleTabKeyDown}
					>
						{MODAL_TABS.map(tab => (
							<button
								key={tab.id}
								id={`modal-tab-${tab.id}`}
								role="tab"
								aria-selected={activeTab === tab.id}
								aria-controls={`modal-panel-${tab.id}`}
								onClick={() => setActiveTab(tab.id)}
								className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
									activeTab === tab.id 
									? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
									: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
								}`}
							>
								<tab.icon className="w-4 h-4" /> {tab.label}
							</button>
						))}
					</nav>
				</div>
				
				{/* Main Content Area */}
				<div className="flex-1 flex flex-col overflow-hidden relative">
					<button 
						onClick={onClose}
						className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition-colors"
						aria-label="Close settings"
					>
						<X className="w-5 h-5" />
					</button>
					
					<div className="flex-1 overflow-y-auto p-6 md:p-10 hide-scrollbar">
						{activeTab === 'ai' && (
							<div id="modal-panel-ai" role="tabpanel" aria-labelledby="modal-tab-ai" className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">AI & Models</h2>
								<p className="text-sm text-on-surface-variant mb-8">Manage your connected AI providers, local models, and billing tiers.</p>
								<AIProviderSettings 
									registryState={registryState} 
									onSaveRegistry={onSaveRegistry} 
									user={user} 
								/>
							</div>
						)}
						{activeTab === 'general' && (
							<div id="modal-panel-general" role="tabpanel" aria-labelledby="modal-tab-general" className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">General Settings</h2>
								<p className="text-sm text-on-surface-variant mb-8">Manage your profile and workspace basics.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'editor' && (
							<div id="modal-panel-editor" role="tabpanel" aria-labelledby="modal-tab-editor" className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Editor Preferences</h2>
								<p className="text-sm text-on-surface-variant mb-8">Customize your writing environment.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'plan' && (
							<div id="modal-panel-plan" role="tabpanel" aria-labelledby="modal-tab-plan" className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Plan & Usage</h2>
								<p className="text-sm text-on-surface-variant mb-8">View your current billing and credit usage.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'privacy' && (
							<div id="modal-panel-privacy" role="tabpanel" aria-labelledby="modal-tab-privacy" className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Privacy & Vault</h2>
								<p className="text-sm text-on-surface-variant mb-8">Manage end-to-end encryption and local data.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
