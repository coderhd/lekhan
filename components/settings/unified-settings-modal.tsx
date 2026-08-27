import React, { useState } from 'react'
import { X, Bot, Settings, Paintbrush, CreditCard, Shield } from 'lucide-react'
import { AIProviderSettings } from './ai-provider-settings'

interface UnifiedSettingsModalProps {
	isOpen: boolean
	onClose: () => void
}

export function UnifiedSettingsModal({ isOpen, onClose }: UnifiedSettingsModalProps) {
	const [activeTab, setActiveTab] = useState<'ai' | 'general' | 'editor' | 'plan' | 'privacy'>('ai')

	if (!isOpen) return null

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
					
					<nav className="flex-1 overflow-y-auto px-4 pb-4 space-y-1" role="tablist" aria-orientation="vertical">
						<button
							role="tab"
							aria-selected={activeTab === 'ai'}
							onClick={() => setActiveTab('ai')}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
								activeTab === 'ai' 
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
							}`}
						>
							<Bot className="w-4 h-4" /> AI & Models
						</button>
						<button
							role="tab"
							aria-selected={activeTab === 'general'}
							onClick={() => setActiveTab('general')}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
								activeTab === 'general' 
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
							}`}
						>
							<Settings className="w-4 h-4" /> General & Profile
						</button>
						<button
							role="tab"
							aria-selected={activeTab === 'editor'}
							onClick={() => setActiveTab('editor')}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
								activeTab === 'editor' 
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
							}`}
						>
							<Paintbrush className="w-4 h-4" /> Editor & Preferences
						</button>
						<button
							role="tab"
							aria-selected={activeTab === 'plan'}
							onClick={() => setActiveTab('plan')}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
								activeTab === 'plan' 
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
							}`}
						>
							<CreditCard className="w-4 h-4" /> Plan & Usage
						</button>
						<button
							role="tab"
							aria-selected={activeTab === 'privacy'}
							onClick={() => setActiveTab('privacy')}
							className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
								activeTab === 'privacy' 
								? 'bg-primary-container text-on-primary-container font-bold shadow-sm' 
								: 'text-on-surface-variant hover:bg-black/5 dark:hover:bg-white/5 hover:text-on-surface'
							}`}
						>
							<Shield className="w-4 h-4" /> Privacy & Vault
						</button>
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
					
					<div className="flex-1 overflow-y-auto p-6 md:p-10 hide-scrollbar" role="tabpanel">
						{activeTab === 'ai' && (
							<div className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">AI & Models</h2>
								<p className="text-sm text-on-surface-variant mb-8">Manage your connected AI providers, local models, and billing tiers.</p>
								<AIProviderSettings />
							</div>
						)}
						{activeTab === 'general' && (
							<div className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">General Settings</h2>
								<p className="text-sm text-on-surface-variant mb-8">Manage your profile and workspace basics.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'editor' && (
							<div className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Editor Preferences</h2>
								<p className="text-sm text-on-surface-variant mb-8">Customize your writing environment.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'plan' && (
							<div className="animate-in fade-in slide-in-from-right-4 duration-300">
								<h2 className="text-2xl font-display-lg text-on-surface mb-2">Plan & Usage</h2>
								<p className="text-sm text-on-surface-variant mb-8">View your current billing and credit usage.</p>
								<div className="p-8 border border-dashed border-black/10 dark:border-white/10 rounded-2xl flex items-center justify-center text-on-surface-variant">
									Coming Soon
								</div>
							</div>
						)}
						{activeTab === 'privacy' && (
							<div className="animate-in fade-in slide-in-from-right-4 duration-300">
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
