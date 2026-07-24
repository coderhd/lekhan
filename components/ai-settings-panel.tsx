'use client'

import { useState, useEffect } from 'react'
import { CustomSelect } from './ui/custom-select'
import {
	LANGUAGES,
	TTS_LANGUAGES,
	SPEAKERS,
	loadAIPreferences,
	saveAIPreferences,
} from '@/lib/ai-constants'

interface AISettingsPanelProps {
	isOpen: boolean
	onClose: () => void
	editor?: any
	token?: string
	detectedLanguage?: { code: string; name: string; script: string } | null
	isDetecting?: boolean
	onOverrideLanguage?: (lang: { code: string; name: string; script: string } | null) => void
}

export default function AISettingsPanel({
	isOpen,
	onClose,
	detectedLanguage,
	isDetecting = false,
}: AISettingsPanelProps) {
	const [targetLanguage, setTargetLanguage] = useState('hi-IN')
	const [ttsLanguage, setTtsLanguage] = useState('hi-IN')
	const [ttsVoice, setTtsVoice] = useState('priya')

	// Load persisted preferences when the panel mounts
	useEffect(() => {
		const prefs = loadAIPreferences()
		setTargetLanguage(prefs.targetLanguage)
		setTtsLanguage(prefs.ttsLanguage)
		setTtsVoice(prefs.ttsVoice)
	}, [])

	const handleTargetLanguageChange = (value: string) => {
		setTargetLanguage(value)
		saveAIPreferences({ targetLanguage: value })
	}

	const handleTtsLanguageChange = (value: string) => {
		setTtsLanguage(value)
		saveAIPreferences({ ttsLanguage: value })
	}

	const handleTtsVoiceChange = (value: string) => {
		setTtsVoice(value)
		saveAIPreferences({ ttsVoice: value })
	}

	if (!isOpen) {
		return null
	}

	return (
		<aside className='absolute right-0 top-0 bottom-0 w-80 bg-background border-l border-black/10 dark:border-white/10 p-6 flex flex-col z-[60] shadow-md backdrop-blur-xl animate-in slide-in-from-right duration-200'>
			<div className='flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6'>
				<div className='flex items-center gap-sm'>
					<div className='w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center'>
						<span className="material-symbols-outlined text-primary-container">settings</span>
					</div>
					<div>
						<div className="flex items-center gap-2">
							<h3 className="font-title-lg text-title-lg text-on-surface">Settings</h3>
							<span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">85 Credits left</span>
						</div>
						<p className="text-[10px] text-primary-container/80 uppercase tracking-widest font-bold">AI Preferences</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className='w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition shrink-0'
					title="Close Settings"
				>
					<span className="material-symbols-outlined text-lg">close</span>
				</button>
			</div>

			<div className='flex-1 overflow-y-auto px-1.5 -mx-1.5 py-1 -my-1 space-y-6 text-left touch-scroll-container no-scrollbar'>
				{/* Document Intelligence */}
				<div className='space-y-2'>
					<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
						Document Primary Language
					</p>
					<div className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3 flex flex-col gap-1.5'>
						<div className='flex items-center gap-2'>
							<span className="material-symbols-outlined text-primary-container text-base">translate</span>
							{isDetecting ? (
								<span className='text-xs text-on-surface-variant/60'>Detecting document language...</span>
							) : detectedLanguage ? (
								<span className='text-xs text-on-surface'>
									Detected: <span className='font-semibold text-primary-container'>{detectedLanguage.name}</span> <span className='text-on-surface-variant/60'>({detectedLanguage.script})</span>
								</span>
							) : (
								<span className='text-xs text-on-surface-variant/60'>Start typing in document to detect language</span>
							)}
						</div>
						<div className='text-[11px] text-on-surface-variant/60 leading-normal'>
							For multilingual documents, this is automatically used as the source language for Lekhan Bot transliteration and AI actions.
						</div>
					</div>
				</div>

				{/* AI Preferences */}
				<div className='space-y-4'>
					<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
						AI Preferences
					</p>

					<div>
						<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
							Default translate target
						</label>
						<CustomSelect
							value={targetLanguage}
							onValueChange={handleTargetLanguageChange}
							options={LANGUAGES.map(lang => ({ label: `${lang.name} (${lang.script})`, value: lang.code }))}
							triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
						/>
					</div>

					<div>
						<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
							Default TTS language
						</label>
						<CustomSelect
							value={ttsLanguage}
							onValueChange={handleTtsLanguageChange}
							options={TTS_LANGUAGES.map(lang => ({ label: lang.name, value: lang.code }))}
							triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
						/>
					</div>

					<div>
						<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
							Default TTS voice
						</label>
						<CustomSelect
							value={ttsVoice}
							onValueChange={handleTtsVoiceChange}
							options={SPEAKERS.map(sp => ({
								label: sp.tone ? `${sp.name} — ${sp.tone}` : sp.name,
								value: sp.id,
							}))}
							triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
						/>
					</div>
				</div>

				{/* Quick Reference */}
				<div className='space-y-2'>
					<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
						Keyboard Shortcuts
					</p>
					<div className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-3 space-y-2 text-xs text-on-surface'>
						<div className='flex items-center justify-between'>
							<span className='text-on-surface-variant/70'>Open Lekhan Bot</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">⌘ L</kbd>
						</div>
						<div className='flex items-center justify-between'>
							<span className='text-on-surface-variant/70'>Block commands</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">/</kbd>
						</div>
						<div className='flex items-center justify-between'>
							<span className='text-on-surface-variant/70'>Dismiss</span>
							<kbd className="bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded text-[10px] font-mono">Esc</kbd>
						</div>
					</div>
				</div>
			</div>

			<div className='mt-auto pt-4 text-left border-t border-black/5 dark:border-white/5'>
				<p className='text-[10px] text-on-surface-variant/50 leading-relaxed'>
					AI-generated content may be inaccurate or misleading. Always review and verify important information before using it in your document.
				</p>
			</div>
		</aside>
	)
}
