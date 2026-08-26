'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
	LEKHAN_BOT_ACTIONS,
	LANGUAGES,
	loadAIPreferences,
	type LekhanBotAction,
} from '@/lib/ai-constants'

import { getUserAICredits } from '@/services/db'
import { supabase } from '@/lib/supabase'
import { track } from '@/lib/analytics'

interface LekhanBotBarProps {
	editor: any
	token: string
	isVisible: boolean
	onClose: () => void
	onResult: (actionId: string, result: string, originalText: string) => void
	detectedLanguage?: { code: string; name: string; script: string } | null
	creditsRemaining?: number
}

export default function LekhanBotBar({
	editor,
	token,
	isVisible,
	onClose,
	onResult,
	detectedLanguage,
	creditsRemaining,
}: LekhanBotBarProps) {
	const [prompt, setPrompt] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [showPresets, setShowPresets] = useState(true)
	const [showTranslatePicker, setShowTranslatePicker] = useState(false)
	const [showTransliteratePicker, setShowTransliteratePicker] = useState(false)
	const [mounted, setMounted] = useState(false)
	const [fetchedCredits, setFetchedCredits] = useState<number | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		setMounted(true)
	}, [])

	const getSelectedText = (): string => {
		if (!editor) return ''
		const { from, to } = editor.state.selection
		return editor.state.doc.textBetween(from, to, ' ').trim()
	}

	// Focus, show presets and fetch credits when bar opens
	useEffect(() => {
		if (isVisible) {
			setShowPresets(true)
			setShowTranslatePicker(false)
			setShowTransliteratePicker(false)
			setTimeout(() => inputRef.current?.focus(), 100)

			const loadCredits = async () => {
				try {
					const { data: { user } } = await supabase.auth.getUser()
					if (user?.id) {
						const creds = await getUserAICredits(user.id)
						setFetchedCredits(creds.remainingCredits)
					}
				} catch {
					// Fallback
				}
			}
			loadCredits()
		}
	}, [isVisible])

	const displayCredits = creditsRemaining ?? fetchedCredits ?? 50

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isVisible) {
				onClose()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [isVisible, onClose])

	const callAPI = async (body: Record<string, string>) => {
		track('ai_message_sent', {
			action: body.action || 'custom_prompt',
		})
		const res = await fetch('/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const err = await res.json()
			throw new Error(err.error || 'Request failed')
		}
		return res.json()
	}

	const callAI = async (
		apiAction: string,
		body: Record<string, string>,
		actionId: string,
		originalText: string,
	) => {
		setIsLoading(true)
		try {
			const data = await callAPI(body)
			const result = data.translatedText
				|| data.transliteratedText
				|| data.text
				|| ''
			onResult(actionId, result, originalText)
			setPrompt('')
			setShowPresets(true)
			setShowTranslatePicker(false)
			setShowTransliteratePicker(false)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Lekhan Bot: ${message}`)
		} finally {
			setIsLoading(false)
		}
	}

	const handlePresetAction = (action: LekhanBotAction) => {
		const selectedText = getSelectedText()
		if (action.requiresSelection && !selectedText) {
			toast.error('Select some text first, then try again')
			return
		}
		callAI(
			'chat',
			{
				action: 'chat',
				prompt: action.buildPrompt(selectedText),
			},
			action.id,
			selectedText,
		)
	}

	const handleTranslate = (targetLanguage: string) => {
		const selectedText = getSelectedText()
		if (!selectedText) {
			toast.error('Select some text to translate')
			return
		}
		setShowTranslatePicker(false)
		callAI(
			'translate',
			{ action: 'translate', text: selectedText, targetLanguage },
			'translate',
			selectedText,
		)
	}

	const handleTransliterate = async (targetLanguage: string) => {
		const selectedText = getSelectedText()
		if (!selectedText) {
			toast.error('Select some text to transliterate')
			return
		}
		setShowTransliteratePicker(false)
		setIsLoading(true)
		try {
			const prefs = loadAIPreferences()
			const sourceLanguage = detectedLanguage?.code || prefs.targetLanguage || 'hi-IN'
			const data = await callAPI({
				action: 'transliterate',
				text: selectedText,
				sourceLanguage,
				targetLanguage,
			})
			onResult('transliterate', data.transliteratedText || '', selectedText)
			setPrompt('')
			setShowPresets(true)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Lekhan Bot: ${message}`)
		} finally {
			setIsLoading(false)
		}
	}

	const handleReadAloud = () => {
		const prefs = loadAIPreferences()
		const text = getSelectedText() || editor?.getText().trim()
		if (!text) {
			toast.error('Document is empty')
			return
		}
		setIsLoading(true)
		track('ai_message_sent', { action: 'tts' })
		fetch('/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				action: 'tts',
				text: text.slice(0, 10000),
				targetLanguage: prefs.ttsLanguage,
				speaker: prefs.ttsVoice,
			}),
		})
			.then(res => {
				if (!res.ok) throw new Error('TTS failed')
				return res.json()
			})
			.then(data => {
				const audio = new Audio(`data:audio/wav;base64,${data.base64Audio}`)
				audio.play()
			})
			.catch(err => {
				const message = err instanceof Error ? err.message : String(err)
				toast.error(`Read aloud failed: ${message}`)
			})
			.finally(() => setIsLoading(false))
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!prompt.trim() || isLoading) return

		const selectedText = getSelectedText()
		const fullPrompt = selectedText
			? `Context: "${selectedText}"\n\nInstruction: ${prompt}`
			: prompt

		callAI(
			'chat',
			{ action: 'chat', prompt: fullPrompt },
			'custom-prompt',
			selectedText,
		)
	}

	if (!isVisible || !mounted) return null

	const selectedText = getSelectedText()

	return createPortal(
		<div className="fixed bottom-6 inset-x-0 mx-auto w-full max-w-4xl z-50 px-4 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200 ease-out origin-bottom pointer-events-auto">
			{/* Unified Popout Container Card */}
			<div className="flex flex-col rounded-3xl border-2 border-primary-container/40 focus-within:border-primary-container bg-surface-container-high dark:bg-surface-container-high backdrop-blur-2xl shadow-2xl overflow-hidden">

				{/* Top Popout Options Section */}
				{(showPresets || showTranslatePicker || showTransliteratePicker || selectedText) && !isLoading && (
					<div className="p-3.5 border-b border-black/10 dark:border-white/10 bg-surface-container/60 dark:bg-surface-container/60 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150 origin-bottom">

						{/* Selection context hint badge */}
						{selectedText && (
							<div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary-container/10 border border-primary-container/25 text-xs text-on-surface">
								<span className="material-symbols-outlined text-primary-container text-sm shrink-0">format_quote</span>
								<span className="font-semibold text-primary-container shrink-0">Selected:</span>
								<span className="truncate text-on-surface/90 italic">&quot;{selectedText.slice(0, 90)}{selectedText.length > 90 ? '...' : ''}&quot;</span>
							</div>
						)}

						{/* Presets grid — 2 balanced rows of 4 items each */}
						{showPresets && !showTranslatePicker && !showTransliteratePicker && (
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
								{LEKHAN_BOT_ACTIONS.map(action => (
									<button
										key={action.id}
										onClick={() => handlePresetAction(action)}
										disabled={action.requiresSelection && !selectedText}
										className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border transition-all active:scale-95 ${action.requiresSelection && !selectedText
											? 'border-black/5 dark:border-white/5 text-on-surface-variant/30 bg-black/5 dark:bg-white/5 cursor-not-allowed'
											: 'border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/40 shadow-sm'
											}`}
									>
										<span className="material-symbols-outlined text-base text-primary-container">{action.icon}</span>
										<span>{action.label}</span>
									</button>
								))}

								{/* Translate button */}
								<button
									onClick={() => setShowTranslatePicker(true)}
									disabled={!selectedText}
									className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border transition-all active:scale-95 ${!selectedText
										? 'border-black/5 dark:border-white/5 text-on-surface-variant/30 bg-black/5 dark:bg-white/5 cursor-not-allowed'
										: 'border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/40 shadow-sm'
										}`}
								>
									<span className="material-symbols-outlined text-base text-primary-container">translate</span>
									<span>Translate</span>
								</button>

								{/* Transliterate button */}
								<button
									onClick={() => setShowTransliteratePicker(true)}
									disabled={!selectedText}
									className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border transition-all active:scale-95 ${!selectedText
										? 'border-black/5 dark:border-white/5 text-on-surface-variant/30 bg-black/5 dark:bg-white/5 cursor-not-allowed'
										: 'border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/40 shadow-sm'
										}`}
								>
									<span className="material-symbols-outlined text-base text-primary-container">language</span>
									<span>Transliterate</span>
								</button>

								{/* Read Aloud button */}
								<button
									onClick={handleReadAloud}
									className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-xl border border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/40 transition-all active:scale-95 shadow-sm"
								>
									<span className="material-symbols-outlined text-base text-primary-container">volume_up</span>
									<span>Read Aloud</span>
								</button>
							</div>
						)}

						{/* Language picker for Translate */}
						{showTranslatePicker && (
							<div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-y-auto touch-scroll-container">
								<button
									onClick={() => setShowTranslatePicker(false)}
									className="flex items-center gap-1 text-xs text-on-surface-variant/70 hover:text-on-surface px-2.5 py-1 transition rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
								>
									<span className="material-symbols-outlined text-sm">arrow_back</span>
									Back
								</button>
								{LANGUAGES.map(lang => (
									<button
										key={lang.code}
										onClick={() => handleTranslate(lang.code)}
										className="px-2.5 py-1 text-[11px] rounded-lg border border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/30 transition shadow-sm"
									>
										{lang.name}
									</button>
								))}
							</div>
						)}

						{/* Script picker for Transliterate */}
						{showTransliteratePicker && (
							<div className="flex flex-wrap items-center gap-1.5 max-h-32 overflow-y-auto touch-scroll-container">
								<button
									onClick={() => setShowTransliteratePicker(false)}
									className="flex items-center gap-1 text-xs text-on-surface-variant/70 hover:text-on-surface px-2.5 py-1 transition rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
								>
									<span className="material-symbols-outlined text-sm">arrow_back</span>
									Back
								</button>
								{LANGUAGES.map(lang => (
									<button
										key={lang.code}
										onClick={() => handleTransliterate(lang.code)}
										className="px-2.5 py-1 text-[11px] rounded-lg border border-black/10 dark:border-white/10 text-on-surface bg-surface-container-low dark:bg-surface-container-low hover:bg-primary-container/15 hover:border-primary-container/30 transition shadow-sm"
										title={`Transliterate to ${lang.script} script`}
									>
										{lang.name} <span className="text-on-surface-variant/40">({lang.script})</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{/* Bottom Prompt Input Bar */}
				<form
					onSubmit={handleSubmit}
					className="flex items-center gap-3 px-4 py-3 bg-transparent"
				>
					<span className="material-symbols-outlined text-primary-container text-xl">
						auto_awesome
					</span>
					<input
						ref={inputRef}
						type="text"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onFocus={() => { setShowPresets(true); setShowTranslatePicker(false); setShowTransliteratePicker(false) }}
						placeholder="Ask Lekhan Bot anything..."
						disabled={isLoading}
						className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/40 outline-none disabled:opacity-50 font-body-md"
					/>
					{isLoading ? (
						<span className="animate-spin h-5 w-5 border-2 border-primary-container border-t-transparent rounded-full" />
					) : (
						<>
							<span className="hidden sm:inline-flex text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20 shrink-0 whitespace-nowrap">{displayCredits} Credits left</span>
							<button
								type="button"
								onClick={onClose}
								className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition shrink-0"
								title="Close (Esc)"
							>
								<span className="material-symbols-outlined text-lg">close</span>
							</button>
							<button
								type="submit"
								disabled={!prompt.trim()}
								className="w-8 h-8 rounded-xl bg-primary-container text-on-primary-container hover:brightness-110 flex items-center justify-center transition disabled:opacity-30 active:scale-95 shadow-sm shrink-0"
							>
								<span className="material-symbols-outlined text-lg font-bold">arrow_upward</span>
							</button>
						</>
					)}
				</form>
			</div>
		</div>,
		document.body,
	)
}
