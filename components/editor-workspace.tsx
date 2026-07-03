'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { Bold, Italic, Code, Heading1, Heading2, List, ListOrdered, ArrowLeft } from 'lucide-react'
import { useEditorCollab } from '@/hooks/use-editor-collab'
import SyncIndicator from './sync-indicator'
import { supabase } from '@/lib/supabase'
import ShareModal from './share-modal'

interface EditorWorkspaceProps {
	documentId: string
	initialTitle: string
	token: string
	currentUser: {
		id: string
		email: string
		full_name?: string
	}
}

const CURSOR_COLORS = [
	'#3b82f6', // blue
	'#10b981', // emerald
	'#f59e0b', // amber
	'#8b5cf6', // violet
	'#ec4899', // pink
	'#ef4444', // red
]

export default function EditorWorkspace ({
	documentId,
	initialTitle,
	token,
	currentUser,
}: EditorWorkspaceProps) {
	const router = useRouter()
	const [title, setTitle] = useState(initialTitle)
	const [userColor] = useState(() => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)])
	const [isShareOpen, setIsShareOpen] = useState(false)

	const collabUser = {
		id: currentUser.id,
		name: currentUser.full_name || currentUser.email,
		color: userColor,
	}

	const {
		ydoc,
		isConnected,
		isSynced,
		activeUsers,
		hasUnsyncedChanges,
	} = useEditorCollab(documentId, token, collabUser)

	// 1. Unload protection
	useEffect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (hasUnsyncedChanges) {
				e.preventDefault()
				e.returnValue = 'Unsaved changes! Edits are saved locally but not yet synced with the server.'
				return e.returnValue
			}
		}
		window.addEventListener('beforeunload', handleBeforeUnload)
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload)
		}
	}, [hasUnsyncedChanges])

	// 2. Initialize Tiptap Editor
	const editor = useEditor({
		extensions: ydoc ? [
			StarterKit.configure({
				history: false,
			}),
			Collaboration.configure({
				document: ydoc,
			}),
			CollaborationCursor.configure({
				provider: null, // Custom awareness logic handled inside our hook
				user: {
					name: collabUser.name,
					color: collabUser.color,
				},
			}),
		] : [],
		editorProps: {
			attributes: {
				class: 'prose prose-invert max-w-none focus:outline-none min-h-[500px] p-8 text-white',
			},
		},
	}, [ydoc])

	// Update editor when ydoc loads
	useEffect(() => {
		if (editor && ydoc) {
			// Trigger collaboration bindings manually if needed
		}
	}, [editor, ydoc])

	const handleTitleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const newTitle = e.target.value
		setTitle(newTitle)
		try {
			await supabase
				.from('documents')
				.update({ title: newTitle })
				.eq('id', documentId)
		} catch (err) {
			console.error('Error updating title:', err)
		}
	}

	if (!ydoc || !editor) {
		return (
			<div className='flex min-h-screen items-center justify-center bg-slate-950 text-white'>
				<div className='flex flex-col items-center gap-3'>
					<span className='h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent' />
					<p className='text-sm text-slate-400 font-semibold'>Loading document workspace...</p>
				</div>
			</div>
		)
	}

	return (
		<div className='flex min-h-screen flex-col bg-slate-950 text-white'>
			{/* Top Navbar */}
			<header className='flex items-center justify-between border-b border-white/5 bg-slate-900/40 px-6 py-4 backdrop-blur-md sticky top-0 z-50'>
				<div className='flex items-center gap-4 flex-1'>
					<button
						onClick={() => router.push('/')}
						className='rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition'
					>
						<ArrowLeft className='h-5 w-5' />
					</button>
					<input
						type='text'
						value={title}
						onChange={handleTitleChange}
						className='bg-transparent text-xl font-bold tracking-tight text-white focus:outline-none border-b border-transparent focus:border-indigo-500 pb-0.5 max-w-[300px] sm:max-w-[450px]'
						placeholder='Untitled Document'
					/>
					<SyncIndicator isConnected={isConnected} isSynced={isSynced} />
				</div>

				<div className='flex items-center gap-4'>
					{/* Active Collaborators */}
					<div className='flex items-center -space-x-2'>
						{activeUsers.map((activeUser, idx) => (
							<div
								key={idx}
								style={{ borderColor: activeUser.color }}
								className='flex h-8 w-8 items-center justify-center rounded-full border-2 bg-slate-800 text-[10px] font-bold uppercase select-none cursor-default'
								title={activeUser.name}
							>
								{activeUser.name.slice(0, 2)}
							</div>
						))}
					</div>

					<button
						onClick={() => setIsShareOpen(true)}
						className='rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-95'
					>
						Share
					</button>
				</div>
			</header>

			{/* Main Workspace Grid */}
			<main className='flex-1 flex flex-col md:flex-row max-w-6xl mx-auto w-full p-4 md:p-8 gap-6'>
				<div className='flex-1 flex flex-col rounded-2xl border border-white/5 bg-slate-900/30 backdrop-blur-md overflow-hidden'>
					{/* Formatting Toolbar */}
					<div className='flex flex-wrap items-center gap-1 border-b border-white/5 bg-slate-900/50 p-2'>
						<button
							onClick={() => editor.chain().focus().toggleBold().run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('bold') ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Bold'
						>
							<Bold className='h-4 w-4' />
						</button>
						<button
							onClick={() => editor.chain().focus().toggleItalic().run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('italic') ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Italic'
						>
							<Italic className='h-4 w-4' />
						</button>
						<button
							onClick={() => editor.chain().focus().toggleCode().run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('code') ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Code Inline'
						>
							<Code className='h-4 w-4' />
						</button>
						<div className='h-4 w-px bg-white/10 mx-1' />
						<button
							onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('heading', { level: 1 }) ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Heading 1'
						>
							<Heading1 className='h-4 w-4' />
						</button>
						<button
							onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Heading 2'
						>
							<Heading2 className='h-4 w-4' />
						</button>
						<div className='h-4 w-px bg-white/10 mx-1' />
						<button
							onClick={() => editor.chain().focus().toggleBulletList().run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('bulletList') ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Bullet List'
						>
							<List className='h-4 w-4' />
						</button>
						<button
							onClick={() => editor.chain().focus().toggleOrderedList().run()}
							className={`rounded-lg p-2 hover:bg-slate-800 transition ${editor.isActive('orderedList') ? 'bg-slate-800 text-indigo-400' : 'text-slate-400'}`}
							title='Ordered List'
						>
							<ListOrdered className='h-4 w-4' />
						</button>
					</div>

					{/* Editor Canvas */}
					<div className='flex-1 overflow-y-auto bg-slate-950/20'>
						<EditorContent editor={editor} />
					</div>
				</div>
			</main>

			{/* Footer links */}
			<footer className='border-t border-white/5 py-6 text-center text-xs text-slate-500 bg-slate-950'>
				<p>
					Developed by <span className='text-slate-400 font-semibold'>Harsh Dave</span> |{' '}
					<a href='https://github.com/harshdave' className='text-indigo-400 hover:underline' target='_blank' rel='noreferrer'>GitHub Profile</a> |{' '}
					<a href='https://linkedin.com/in/harshdave' className='text-indigo-400 hover:underline' target='_blank' rel='noreferrer'>LinkedIn Profile</a>
				</p>
			</footer>

			<ShareModal
				isOpen={isShareOpen}
				onClose={() => setIsShareOpen(false)}
				documentId={documentId}
				documentTitle={title}
				userId={currentUser.id}
			/>
		</div>
	)
}
