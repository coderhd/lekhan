'use client'

import { BubbleMenu, Editor } from '@tiptap/react'
import { Sparkles, Languages, Volume2, Type, Bold, Italic, Underline } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'

interface AIBubbleMenuProps {
	editor: any
	token: string
}

export default function AIBubbleMenu({ editor, token }: AIBubbleMenuProps) {
	const [loading, setLoading] = useState(false)

	if (!editor) {
		return null
	}

	const handleTranslate = async () => {
		const { from, to } = editor.state.selection
		const selectedText = editor.state.doc.textBetween(from, to, ' ')
		const text = selectedText.trim()
		
		if (!text) return

		setLoading(true)
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
					targetLanguage: 'hi-IN',
				}),
			})

			if (!res.ok) throw new Error('Failed to translate')
			
			const data = await res.json()
			editor.chain().focus().insertContent(data.translatedText).run()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Translation failed: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleTTS = async () => {
		const { from, to } = editor.state.selection
		const selectedText = editor.state.doc.textBetween(from, to, ' ')
		const text = selectedText.trim()
		
		if (!text) return

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
					targetLanguage: 'en-IN',
					speaker: 'shubh',
				}),
			})

			if (!res.ok) throw new Error('Failed to generate speech')
			
			const data = await res.json()
			const url = `data:audio/wav;base64,${data.base64Audio}`
			const audio = new Audio(url)
			audio.play()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`TTS failed: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	return (
		<BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="flex overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-md shadow-xl p-1 z-50">
			<button
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={`p-2 transition rounded-md ${editor.isActive('bold') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Bold className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={`p-2 transition rounded-md ${editor.isActive('italic') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Italic className="h-4 w-4" />
			</button>
			<button
				onClick={() => editor.chain().focus().toggleUnderline().run()}
				className={`p-2 transition rounded-md ${editor.isActive('underline') ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground'}`}
			>
				<Underline className="h-4 w-4" />
			</button>
			
			<div className="w-px bg-border mx-1 my-1" />
			
			<button
				onClick={handleTranslate}
				disabled={loading}
				className="flex items-center gap-1.5 p-2 px-3 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md disabled:opacity-50"
			>
				<Languages className="h-3.5 w-3.5" />
				<span>{loading ? 'Translating...' : 'Translate (HI)'}</span>
			</button>

			<div className="w-px bg-border mx-1 my-1" />

			<button
				onClick={handleTTS}
				disabled={loading}
				className="flex items-center gap-1.5 p-2 px-3 text-xs font-semibold hover:bg-primary/10 text-primary transition rounded-md disabled:opacity-50"
			>
				<Volume2 className="h-3.5 w-3.5" />
				<span>{loading ? 'Generating...' : 'Listen'}</span>
			</button>
		</BubbleMenu>
	)
}
