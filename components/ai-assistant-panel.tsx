'use client'

import { useState, useRef } from 'react'

import { toast } from 'sonner'
import { CustomSelect } from './ui/custom-select'

const LANGUAGES = [
	{ code: 'hi-IN', name: 'Hindi' },
	{ code: 'bn-IN', name: 'Bengali' },
	{ code: 'ta-IN', name: 'Tamil' },
	{ code: 'te-IN', name: 'Telugu' },
	{ code: 'gu-IN', name: 'Gujarati' },
	{ code: 'mr-IN', name: 'Marathi' },
	{ code: 'kn-IN', name: 'Kannada' },
	{ code: 'ml-IN', name: 'Malayalam' },
	{ code: 'pa-IN', name: 'Punjabi' },
	{ code: 'or-IN', name: 'Odia' },
]

const SPEAKERS = [
	{ id: 'shubh', name: 'Shubh (Male)' },
	{ id: 'aarav', name: 'Aarav (Male)' },
	{ id: 'nisha', name: 'Nisha (Female)' },
]

interface AIAssistantPanelProps {
	isOpen: boolean
	onClose: () => void
	editor: any
	token: string
}

export default function AIAssistantPanel({
	isOpen,
	onClose,
	editor,
	token,
}: AIAssistantPanelProps) {
	const [activeTab, setActiveTab] = useState<'assistant' | 'translate' | 'tts'>('assistant')
	const [loading, setLoading] = useState(false)
	const [result, setResult] = useState('')
	const [targetLang, setTargetLang] = useState('hi-IN')
	const [speaker, setSpeaker] = useState('shubh')
	const [prompt, setPrompt] = useState('')

	const [audioUrl, setAudioUrl] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const audioRef = useRef<HTMLAudioElement | null>(null)

	const handleTabSwitch = (tab: 'assistant' | 'translate' | 'tts') => {
		setActiveTab(tab)
		setResult('')
		setAudioUrl(null)
		if (isPlaying && audioRef.current) {
			audioRef.current.pause()
			setIsPlaying(false)
		}
	}

	const getSelectionText = () => {
		const { from, to } = editor.state.selection
		const selectedText = editor.state.doc.textBetween(from, to, ' ')
		return selectedText.trim()
	}

	const handleTranslate = async () => {
		const text = getSelectionText()
		if (!text) {
			toast.error('Please select some text in the editor to translate')
			return
		}

		setLoading(true)
		setResult('')
		try {
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					action: 'translate',
					text,
					targetLanguage: targetLang,
				}),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'Failed to translate')
			}

			const data = await res.json()
			setResult(data.translatedText)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Translation failed: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleTTS = async () => {
		let text = getSelectionText()
		if (!text) {
			text = editor.getText().trim()
		}

		if (!text) {
			toast.error('Document is empty. Type something to read aloud!')
			return
		}

		setLoading(true)
		try {
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					action: 'tts',
					text,
					targetLanguage: targetLang,
					speaker,
				}),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'Failed to generate speech')
			}

			const data = await res.json()
			const url = `data:audio/wav;base64,${data.base64Audio}`
			setAudioUrl(url)
			setIsPlaying(true)

			if (audioRef.current) {
				audioRef.current.src = url
				audioRef.current.play()
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`TTS failed: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleChatAction = async (actionPrompt: string) => {
		const text = getSelectionText()
		if (!text) {
			toast.error('Please select some text to execute this action')
			return
		}

		setLoading(true)
		setResult('')
		try {
			const fullPrompt = `${actionPrompt}:\n\n"${text}"`
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					action: 'chat',
					prompt: fullPrompt,
				}),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'AI request failed')
			}

			const data = await res.json()
			setResult(data.text)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`AI error: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleCustomPrompt = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!prompt.trim() || loading) {
			return
		}
		setLoading(true)
		setResult('')
		try {
			const text = getSelectionText()
			const fullPrompt = text
				? `Context: "${text}"\n\nPrompt: ${prompt}`
				: prompt

			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					action: 'chat',
					prompt: fullPrompt,
				}),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'AI request failed')
			}

			const data = await res.json()
			setResult(data.text)
			setPrompt('')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`AI error: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const insertResult = () => {
		if (!result) return
		editor.chain().focus().insertContent(result).run()
	}

	const togglePlay = () => {
		if (!audioRef.current) return
		if (isPlaying) {
			audioRef.current.pause()
			setIsPlaying(false)
		} else {
			audioRef.current.play()
			setIsPlaying(true)
		}
	}

	if (!isOpen) {
		return null
	}

	return (
		<aside className='absolute right-0 top-0 bottom-0 w-80 bg-background border-l border-black/10 dark:border-white/10 p-6 flex flex-col z-[60] shadow-md backdrop-blur-xl animate-in slide-in-from-right duration-200'>
			<audio
				ref={audioRef}
				onEnded={() => setIsPlaying(false)}
				className='hidden'
			/>

			<div className='flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-6'>
				<div className='flex items-center gap-sm'>
					<div className='w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center'>
						<span className="material-symbols-outlined text-primary-container">auto_awesome</span>
					</div>
					<div>
						<h3 className="font-title-lg text-title-lg text-on-surface">AI Assistant</h3>
						<p className="text-[10px] text-primary-container/80 uppercase tracking-widest font-bold">Lekhan Intelligence</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className='rounded-lg p-1 hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition'
				>
					<span className="material-symbols-outlined text-lg">close</span>
				</button>
			</div>

			{/* Sub Tabs */}
			<div className='mb-6 flex gap-1 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-1'>
				<button
					onClick={() => handleTabSwitch('assistant')}
					className={`flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'assistant' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface hover:bg-black/5 dark:hover:bg-white/5'}`}
				>
					Assistant
				</button>
				<button
					onClick={() => handleTabSwitch('translate')}
					className={`flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'translate' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface hover:bg-black/5 dark:hover:bg-white/5'}`}
				>
					Translate
				</button>
				<button
					onClick={() => handleTabSwitch('tts')}
					className={`flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'tts' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface hover:bg-black/5 dark:hover:bg-white/5'}`}
				>
					Speech
				</button>
			</div>

			{/* Tab Contents */}
			<div className='flex-1 overflow-y-auto px-1.5 -mx-1.5 py-1 -my-1 space-y-4 text-left no-scrollbar'>
				{activeTab === 'assistant' && (
					<div className='space-y-4'>
						<div className='space-y-2'>
							<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
								Quick Actions
							</p>
							<div className='grid grid-cols-2 gap-2'>
								<button
									onClick={() => handleChatAction('Summarize the following text')}
									className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-2.5 text-xs text-on-surface transition hover:border-primary-container hover:bg-black/10 dark:hover:bg-white/10'
								>
									Summarize
								</button>
								<button
									onClick={() => handleChatAction('Fix spelling and grammar in this text')}
									className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-2.5 text-xs text-on-surface transition hover:border-primary-container hover:bg-black/10 dark:hover:bg-white/10'
								>
									Fix Grammar
								</button>
								<button
									onClick={() => handleChatAction('Improve the writing style of this text')}
									className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-2.5 text-xs text-on-surface transition hover:border-primary-container hover:bg-black/10 dark:hover:bg-white/10'
									title='Make flow better'
								>
									Improve Flow
								</button>
								<button
									onClick={() => handleChatAction('Extend this text with more details')}
									className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-2.5 text-xs text-on-surface transition hover:border-primary-container hover:bg-black/10 dark:hover:bg-white/10'
								>
									Expand
								</button>
							</div>
						</div>

						<form onSubmit={handleCustomPrompt} className='space-y-2'>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
								Ask Assistant
							</label>
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								className='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition min-h-[60px]'
								placeholder='Ask the AI to generate content or rewrite text...'
								required
							/>
							<button
								type='submit'
								disabled={loading}
								className='w-full rounded-xl bg-primary-container text-on-primary-container font-semibold py-2.5 text-xs hover:brightness-110 active:scale-95 transition-all shadow-sm'
							>
								Submit
							</button>
						</form>
					</div>
				)}

				{activeTab === 'translate' && (
					<div className='space-y-4'>
						<div>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
								Target Indian Language
							</label>
							<CustomSelect
								value={targetLang}
								onValueChange={setTargetLang}
								options={LANGUAGES.map(lang => ({ label: lang.name, value: lang.code }))}
								triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
							/>
						</div>

						<button
							onClick={handleTranslate}
							disabled={loading}
							className='w-full flex items-center justify-center gap-1.5 rounded-xl bg-primary-container text-on-primary-container font-semibold py-2.5 text-xs hover:brightness-110 active:scale-95 transition-all shadow-sm'
						>
							<span className="material-symbols-outlined text-sm">translate</span>
							<span>Translate Selection</span>
						</button>
					</div>
				)}

				{activeTab === 'tts' && (
					<div className='space-y-4'>
						<div>
							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
								Language
							</label>
							<CustomSelect
								value={targetLang}
								onValueChange={setTargetLang}
								options={LANGUAGES.map(lang => ({ label: lang.name, value: lang.code }))}
								triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition mb-4'
							/>

							<label className='block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-1.5'>
								Voice Speaker
							</label>
							<CustomSelect
								value={speaker}
								onValueChange={setSpeaker}
								options={SPEAKERS.map(sp => ({ label: sp.name, value: sp.id }))}
								triggerClassName='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 h-[38px] text-xs text-on-surface focus:ring-2 focus:ring-primary-container/50 outline-none premium-transition'
							/>
						</div>

						<button
							onClick={handleTTS}
							disabled={loading}
							className='w-full flex items-center justify-center gap-1.5 rounded-xl bg-primary-container text-on-primary-container font-semibold py-2.5 text-xs hover:brightness-110 active:scale-95 transition-all shadow-sm'
						>
							<span className="material-symbols-outlined text-sm">volume_up</span>
							<span>Read Aloud Selection</span>
						</button>

						{/* Audio player UI */}
						{audioUrl && (
							<div className='rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 flex items-center justify-between'>
								<span className='text-[10px] text-on-surface-variant/70 font-medium truncate max-w-[150px]'>
									Generated Audio Accent
								</span>
								<button
									onClick={togglePlay}
									className='rounded-full bg-primary-container p-2 text-on-primary-container hover:brightness-110 transition active:scale-90 flex items-center justify-center'
								>
									{isPlaying ? (
										<span className="material-symbols-outlined text-sm">pause</span>
									) : (
										<span className="material-symbols-outlined text-sm">play_arrow</span>
									)}
								</button>
							</div>
						)}
					</div>
				)}

				{/* Loading Indicator */}
				{loading && (
					<div className='text-center text-xs text-on-surface-variant/70 py-4 flex items-center justify-center gap-2'>
						<span className="animate-spin h-3.5 w-3.5 border-2 border-primary-container border-t-transparent rounded-full" />
						<span>AI thinking...</span>
					</div>
				)}

				{/* Output Results panel */}
				{result && !loading && (
					<div className='mt-6 border-t border-black/10 dark:border-white/10 pt-6 space-y-3'>
						<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60'>
							AI Output
						</p>
						<div className='rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-4 text-xs text-on-surface whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed'>
							{result}
						</div>
						<button
							onClick={insertResult}
							className='w-full rounded-xl bg-primary-container text-on-primary-container font-semibold py-2 text-xs hover:brightness-110 transition-all'
						>
							Insert at Cursor
						</button>
					</div>
				)}
			</div>

			<div className='mt-auto pt-6 text-left border-t border-black/5 dark:border-white/5'>
				<p className='text-[10px] text-on-surface-variant/50 leading-relaxed'>
					AI-generated content may be inaccurate or misleading. Always review and verify important information before using it in your document.
				</p>
			</div>
		</aside>
	)
}
