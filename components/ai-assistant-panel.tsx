'use client'

import { useState, useRef } from 'react'
import { Sparkles, Languages, Volume2, ArrowLeft, RefreshCw, Play, Pause } from 'lucide-react'

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

export default function AIAssistantPanel ({
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
	
	// Audio playing states
	const [audioUrl, setAudioUrl] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const audioRef = useRef<HTMLAudioElement | null>(null)

	const getSelectionText = () => {
		const { from, to } = editor.state.selection
		const selectedText = editor.state.doc.textBetween(from, to, ' ')
		return selectedText.trim()
	}

	const handleTranslate = async () => {
		const text = getSelectionText()
		if (!text) {
			alert('Please select some text in the editor to translate')
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
		} catch (err: any) {
			alert(`Translation failed: ${err.message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleTTS = async () => {
		let text = getSelectionText()
		if (!text) {
			// Fallback to entire doc text if no selection
			text = editor.getText().trim()
		}

		if (!text) {
			alert('Document is empty. Type something to read aloud!')
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
		} catch (err: any) {
			alert(`TTS failed: ${err.message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleChatAction = async (actionPrompt: string) => {
		const text = getSelectionText()
		if (!text) {
			alert('Please select some text to execute this action')
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
		} catch (err: any) {
			alert(`AI error: ${err.message}`)
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
		} catch (err: any) {
			alert(`AI error: ${err.message}`)
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
		<div className='w-80 border-l border-white/5 bg-slate-900/50 p-6 flex flex-col h-full backdrop-blur-md animate-in slide-in-from-right duration-200'>
			<audio
				ref={audioRef}
				onEnded={() => setIsPlaying(false)}
				className='hidden'
			/>
			
			<div className='flex items-center justify-between border-b border-white/5 pb-4 mb-6'>
				<h3 className='text-lg font-bold text-white flex items-center gap-2'>
					<Sparkles className='h-4 w-4 text-indigo-400' />
					AI Companion
				</h3>
				<button
					onClick={onClose}
					className='rounded-lg p-1 hover:bg-slate-800 text-slate-400 hover:text-white transition'
				>
					<ArrowLeft className='h-4 w-4' />
				</button>
			</div>

			{/* Sub Tabs */}
			<div className='mb-6 flex gap-1 rounded-lg bg-slate-950 p-1'>
				<button
					onClick={() => setActiveTab('assistant')}
					className={`flex-1 rounded px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'assistant' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
				>
					Assistant
				</button>
				<button
					onClick={() => setActiveTab('translate')}
					className={`flex-1 rounded px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'translate' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
				>
					Translate
				</button>
				<button
					onClick={() => setActiveTab('tts')}
					className={`flex-1 rounded px-2.5 py-1.5 text-center text-xs font-semibold transition ${activeTab === 'tts' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
				>
					Speech
				</button>
			</div>

			{/* Tab Contents */}
			<div className='flex-1 overflow-y-auto pr-1 space-y-4 text-left'>
				{activeTab === 'assistant' && (
					<div className='space-y-4'>
						<div className='space-y-2'>
							<p className='text-xs font-bold uppercase tracking-wider text-slate-400'>
								Quick Actions
							</p>
							<div className='grid grid-cols-2 gap-2'>
								<button
									onClick={() => handleChatAction('Summarize the following text')}
									className='rounded-lg border border-white/5 bg-slate-950/40 p-2.5 text-xs text-slate-300 transition hover:border-indigo-500/30 hover:bg-slate-900/50'
								>
									Summarize
								</button>
								<button
									onClick={() => handleChatAction('Fix spelling and grammar in this text')}
									className='rounded-lg border border-white/5 bg-slate-950/40 p-2.5 text-xs text-slate-300 transition hover:border-indigo-500/30 hover:bg-slate-900/50'
								>
									Fix Grammar
								</button>
								<button
									onClick={() => handleChatAction('Improve the writing style of this text')}
									className='rounded-lg border border-white/5 bg-slate-950/40 p-2.5 text-xs text-slate-300 transition hover:border-indigo-500/30 hover:bg-slate-900/50'
									title='Make flow better'
								>
									Improve Flow
								</button>
								<button
									onClick={() => handleChatAction('Extend this text with more details')}
									className='rounded-lg border border-white/5 bg-slate-950/40 p-2.5 text-xs text-slate-300 transition hover:border-indigo-500/30 hover:bg-slate-900/50'
								>
									Expand
								</button>
							</div>
						</div>

						<form onSubmit={handleCustomPrompt} className='space-y-2'>
							<label className='block text-xs font-bold uppercase tracking-wider text-slate-400'>
								Ask Assistant
							</label>
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none min-h-[60px]'
								placeholder='Ask the AI to generate content or rewrite text...'
								required
							/>
							<button
								type='submit'
								disabled={loading}
								className='w-full rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:opacity-50'
							>
								Submit
							</button>
						</form>
					</div>
				)}

				{activeTab === 'translate' && (
					<div className='space-y-4'>
						<div>
							<label className='block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5'>
								Target Indian Language
							</label>
							<select
								value={targetLang}
								onChange={(e) => setTargetLang(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-xs text-white focus:border-indigo-500 focus:outline-none'
							>
								{LANGUAGES.map(lang => (
									<option key={lang.code} value={lang.code}>
										{lang.name}
									</option>
								))}
							</select>
						</div>

						<button
							onClick={handleTranslate}
							disabled={loading}
							className='w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95'
						>
							<Languages className='h-3.5 w-3.5' />
							<span>Translate Selection</span>
						</button>
					</div>
				)}

				{activeTab === 'tts' && (
					<div className='space-y-4'>
						<div>
							<label className='block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5'>
								Language
							</label>
							<select
								value={targetLang}
								onChange={(e) => setTargetLang(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-xs text-white focus:border-indigo-500 focus:outline-none mb-4'
							>
								{LANGUAGES.map(lang => (
									<option key={lang.code} value={lang.code}>
										{lang.name}
									</option>
								))}
							</select>

							<label className='block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5'>
								Voice Speaker
							</label>
							<select
								value={speaker}
								onChange={(e) => setSpeaker(e.target.value)}
								className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-xs text-white focus:border-indigo-500 focus:outline-none'
							>
								{SPEAKERS.map(sp => (
									<option key={sp.id} value={sp.id}>
										{sp.name}
									</option>
								))}
							</select>
						</div>

						<button
							onClick={handleTTS}
							disabled={loading}
							className='w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95'
						>
							<Volume2 className='h-3.5 w-3.5' />
							<span>Read Aloud Selection</span>
						</button>

						{/* Audio player UI */}
						{audioUrl && (
							<div className='rounded-xl border border-white/5 bg-slate-950/60 p-4 flex items-center justify-between'>
								<span className='text-xs text-slate-400 font-medium truncate max-w-[150px]'>
									Generated Audio Accent
								</span>
								<button
									onClick={togglePlay}
									className='rounded-full bg-indigo-600 p-2 text-white hover:bg-indigo-500 transition active:scale-90'
								>
									{isPlaying ? (
										<Pause className='h-4 w-4 fill-current' />
									) : (
										<Play className='h-4 w-4 fill-current ml-0.5' />
									)}
								</button>
							</div>
						)}
					</div>
				)}

				{/* Loading Indicator */}
				{loading && (
					<div className='text-center text-xs text-slate-400 py-4 flex items-center justify-center gap-2'>
						<RefreshCw className='h-3.5 w-3.5 animate-spin text-indigo-400' />
						<span>AI thinking...</span>
					</div>
				)}

				{/* Output Results panel */}
				{result && !loading && (
					<div className='mt-6 border-t border-white/5 pt-6 space-y-3'>
						<p className='text-xs font-bold uppercase tracking-wider text-slate-400'>
							AI Output
						</p>
						<div className='rounded-xl bg-slate-950/60 border border-white/5 p-4 text-xs text-slate-200 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed'>
							{result}
						</div>
						<button
							onClick={insertResult}
							className='w-full rounded bg-indigo-600 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500'
						>
							Insert at Cursor
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
