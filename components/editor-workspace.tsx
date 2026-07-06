'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import FontFamily from '@tiptap/extension-font-family'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import {
	Bold, Italic, Code, Heading1, Heading2, List, ListOrdered,
	EyeOff, Sparkles,
	AlignLeft, AlignCenter, AlignRight, AlignJustify,
	Underline as UnderlineIcon, Highlighter, CheckSquare,
	Link as LinkIcon
} from 'lucide-react'
import { useEditorCollab } from '@/hooks/use-editor-collab'
import SyncIndicator from './sync-indicator'
import { InlineEdit } from './inline-edit'
import ShareModal from './share-modal'
import VersionHistory from './version-history'
import MobileHeaderMenu from './mobile-header-menu'
import MobileInfoPanel from './mobile-info-panel'
import AIAssistantPanel from './ai-assistant-panel'
import AIBubbleMenu from './ai-bubble-menu'
import ProfileMenu from './profile-menu'
import ThemeToggle from './theme-toggle'
import { ColorHighlightPopover } from './color-highlight-popover'
import { ImageUploadButton } from './image-upload-button'
import GlobalLoader from './global-loader'
import { CustomSelect } from './ui/custom-select'
import { PromptDialog } from './ui/prompt-dialog'
import * as Y from 'yjs'
import { CollabUser } from '@/types'
import { fetchDocumentDetails, fetchMemberRole, updateDocumentTitle } from '@/services/db'
import { supabase } from '@/lib/supabase'

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
	'#fca311', // orange
	'#ec4899', // pink
	'#ef4444', // red
]

import Document from '@tiptap/extension-document'
import Placeholder from '@tiptap/extension-placeholder'

const CustomDocument = Document.extend({
	content: 'heading block*',
})

const getSharedExtensions = () => [
	CustomDocument,
	StarterKit.configure({
		history: false,
		document: false,
	}),
	Placeholder.configure({
		placeholder: ({ node }) => {
			if (node.type.name === 'heading') {
				return 'Untitled Document'
			}
			return 'Type / to choose a block, or start typing...'
		},
	}),
	TextStyle,
	FontFamily,
	Color,
	Highlight.configure({ multicolor: true }),
	TextAlign.configure({ types: ['heading', 'paragraph'] }),
	Underline,
	TaskList,
	TaskItem.configure({ nested: true }),
	Image.configure({
		inline: true,
		allowBase64: true,
	}),
	Link.configure({
		openOnClick: false,
		autolink: true,
	}),
]

function getInitials(nameOrEmail: string) {
	if (!nameOrEmail) return '?'
	if (nameOrEmail.includes('@')) {
		return nameOrEmail.charAt(0).toUpperCase()
	}
	const parts = nameOrEmail.split(' ').filter(Boolean)
	if (parts.length > 1) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
	}
	return nameOrEmail.charAt(0).toUpperCase()
}

export default function EditorWorkspace({
	documentId,
	initialTitle,
	token,
	currentUser,
}: EditorWorkspaceProps) {
	const router = useRouter()
	const [title, setTitle] = useState(initialTitle)
	const [userColor] = useState(() => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)])
	const [isShareOpen, setIsShareOpen] = useState(false)
	const [isHistoryOpen, setIsHistoryOpen] = useState(false)
	const [isAIPanelOpen, setIsAIPanelOpen] = useState(false)
	const [previewDoc, setPreviewDoc] = useState<Y.Doc | null>(null)
	const [previewVersionName, setPreviewVersionName] = useState<string | null>(null)
	const [isViewer, setIsViewer] = useState<boolean | null>(null)
	const [theme, setTheme] = useState<'light' | 'dark'>('dark')
	const [isLinkPromptOpen, setIsLinkPromptOpen] = useState(false)

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'dark'
			setTheme(savedTheme)
			if (savedTheme === 'dark') {
				document.documentElement.classList.add('dark')
			} else {
				document.documentElement.classList.remove('dark')
			}
		}
	}, [])

	const toggleTheme = () => {
		const nextTheme = theme === 'dark' ? 'light' : 'dark'
		setTheme(nextTheme)
		localStorage.setItem('theme', nextTheme)
		if (nextTheme === 'dark') {
			document.documentElement.classList.add('dark')
		} else {
			document.documentElement.classList.remove('dark')
		}
	}

	const handleSignOut = async () => {
		await supabase.auth.signOut()
		router.push('/login')
	}

	useEffect(() => {
		const checkRole = async () => {
			try {
				const doc = await fetchDocumentDetails(documentId)
				if (doc && doc.owner_id === currentUser.id) {
					setIsViewer(false)
					return
				}

				const role = await fetchMemberRole(documentId, currentUser.id)
				if (role === 'editor') {
					setIsViewer(false)
				} else {
					setIsViewer(true)
				}
			} catch (err) {
				console.error('Error fetching role:', err)
				setIsViewer(true)
			}
		}
		checkRole()
	}, [documentId, currentUser.id])

	const previewEditor = useEditor({
		extensions: [
			...getSharedExtensions(),
			...(previewDoc ? [
				Collaboration.configure({
					document: previewDoc,
				}),
			] : []),
		],
		editorProps: {
			attributes: {
				class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[500px] text-on-surface select-none pointer-events-none break-words w-full',
			},
		},
		editable: false,
		immediatelyRender: false,
	}, [previewDoc])

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
		provider,
	} = useEditorCollab(documentId, token, collabUser)

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

	const editor = useEditor({
		extensions: [
			...getSharedExtensions(),
			...(ydoc ? [
				Collaboration.configure({
					document: ydoc,
				}),
			] : []),
			...(provider ? [
				CollaborationCursor.configure({
					provider: provider,
					user: {
						name: collabUser.name,
						color: collabUser.color,
					},
				}),
			] : []),
		],
		editorProps: {
			attributes: {
				class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[500px] text-on-surface break-words w-full',
			},
		},
		editable: !isViewer,
		immediatelyRender: false,
	}, [ydoc, provider])

	useEffect(() => {
		if (editor && isViewer !== null) {
			editor.setEditable(!isViewer)
		}
	}, [editor, isViewer])

	const handleSaveTitle = async (newTitle: string) => {
		setTitle(newTitle)
		await updateDocumentTitle(documentId, newTitle)
	}

	if (!ydoc || !editor || isViewer === null) {
		return <GlobalLoader text="Loading workspace..." />
	}

	const initials = getInitials(currentUser?.full_name || currentUser?.email || 'Anonymous')

	return (
		<div className="bg-background text-on-background font-body-md selection:bg-primary-container selection:text-on-primary-container h-screen overflow-hidden flex flex-col">
			{/* Redesigned Top Header and Integrated Toolbar */}
			<header className="flex-none w-full z-50 bg-surface-container/80 backdrop-blur-xl border-b border-black/10 dark:border-white/10 flex flex-col">
				{/* Row 1: App Controls & Document Title */}
				<div className="h-14 px-margin flex justify-between items-center border-b border-white/5">
					<div className="flex items-center gap-md">
						<img alt="Lekhan Logo" className="h-6 w-6 object-contain cursor-pointer hover:scale-110 premium-transition" src="/logo.png" onClick={() => router.push('/')} />
						<div className="flex items-center gap-sm group">
							{!isViewer ? (
								<InlineEdit
									initialValue={title}
									onSave={handleSaveTitle}
								/>
							) : (
								<div className="px-2 py-1 text-sm font-bold text-on-surface truncate max-w-[200px] md:max-w-[400px]">
									{title}
								</div>
							)}
						</div>
						<div className="hidden lg:flex items-center gap-xs ml-2 text-on-surface-variant/60 font-label-sm text-label-sm">
							<SyncIndicator isConnected={isConnected} isSynced={isSynced} />
						</div>
					</div>

					<div className="flex items-center gap-md">
						<div className="hidden sm:flex -space-x-2 items-center mr-4">
							{activeUsers.map((activeUser, idx) => (
								<div
									key={idx}
									style={{ backgroundColor: activeUser.color, color: '#ffffff' }}
									className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-container-low shadow-sm text-[10px] font-bold select-none"
									title={activeUser.name}
								>
									{getInitials(activeUser.name)}
								</div>
							))}
						</div>

						<button
							onClick={() => { setIsHistoryOpen(!isHistoryOpen); setIsAIPanelOpen(false); }}
							className={`hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium ${isHistoryOpen ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/30' : 'bg-surface-container-low'}`}
							title="Version History"
						>
							<span className="material-symbols-outlined text-primary-container text-lg">history</span>
							<span className="hidden lg:inline">History</span>
						</button>

						<button
							onClick={() => { setIsAIPanelOpen(!isAIPanelOpen); setIsHistoryOpen(false); }}
							className={`hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium ${isAIPanelOpen ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/30' : 'bg-surface-container-low'}`}
							title="AI Assistant"
						>
							<span className="material-symbols-outlined text-primary-container text-lg">auto_awesome</span>
							<span className="hidden lg:inline">AI Companion</span>
						</button>

						{!isViewer && (
							<button
								onClick={() => setIsShareOpen(true)}
								className="bg-primary-container text-on-primary-container px-2 md:px-4 h-8 rounded-lg font-bold text-sm hover:brightness-110 active:scale-95 transition-all shadow-sm ml-2 flex items-center justify-center gap-xs"
							>
								<span className="material-symbols-outlined text-lg">share</span>
								<span className="hidden md:inline">Share</span>
							</button>
						)}

						<MobileInfoPanel activeUsers={activeUsers} isConnected={isConnected} isSynced={isSynced} />

						<MobileHeaderMenu
							isHistoryOpen={isHistoryOpen}
							setIsHistoryOpen={setIsHistoryOpen}
							isAIPanelOpen={isAIPanelOpen}
							setIsAIPanelOpen={setIsAIPanelOpen}
							theme={theme}
							toggleTheme={toggleTheme}
						/>

						<div className="hidden md:block ml-2">
							<ThemeToggle />
						</div>

						<div className="ml-2">
							<ProfileMenu user={currentUser} size="sm" />
						</div>
					</div>
				</div>

				{/* Row 2: Formatting Toolbar or Read Only Banner */}
				{!isViewer ? (
					<div className={`min-h-[40px] py-2 px-margin flex flex-nowrap overflow-x-auto hide-scrollbar justify-start xl:justify-center items-center bg-surface-container-low border-y border-black/10 dark:border-white/10 ${previewDoc ? 'opacity-40 pointer-events-none' : ''}`}>

					{/* Font Family Selection */}
					<div className="flex shrink-0 items-center border-r border-black/10 dark:border-white/10 h-6 px-1">
						<CustomSelect
							value={editor?.getAttributes('textStyle').fontFamily || ''}
							onValueChange={(val) => {
								if (val === '') {
									editor?.chain().focus().unsetFontFamily().run()
								} else {
									editor?.chain().focus().setFontFamily(val).run()
								}
							}}
							options={[
								{ label: 'Inter (Default)', value: '' },
								{ label: 'Arial', value: 'Arial, Helvetica, sans-serif', style: { fontFamily: 'Arial, Helvetica, sans-serif' } },
								{ label: 'Comic Sans', value: 'Comic Sans MS, Comic Sans', style: { fontFamily: 'Comic Sans MS, Comic Sans' } },
								{ label: 'Georgia', value: 'Georgia, serif', style: { fontFamily: 'Georgia, serif' } },
								{ label: 'Courier New', value: '"Courier New", Courier, monospace', style: { fontFamily: '"Courier New", Courier, monospace' } },
							]}
							triggerClassName="h-8 w-[140px] border-none bg-transparent hover:bg-black/5 dark:hover:bg-white/10 px-2 font-medium focus:ring-0"
							contentClassName="w-[160px]"
						/>
					</div>

					{/* Text Style / Headings Selection */}
					<div className="flex shrink-0 items-center border-r border-black/10 dark:border-white/10 h-6 px-1">
						<CustomSelect
							value={
								editor?.isActive('heading', { level: 1 }) ? 'h1' :
									editor?.isActive('heading', { level: 2 }) ? 'h2' :
										editor?.isActive('heading', { level: 3 }) ? 'h3' : 'p'
							}
							onValueChange={(val) => {
								if (val === 'p') {
									editor?.chain().focus().setParagraph().run()
								} else if (val === 'h1') {
									editor?.chain().focus().toggleHeading({ level: 1 }).run()
								} else if (val === 'h2') {
									editor?.chain().focus().toggleHeading({ level: 2 }).run()
								} else if (val === 'h3') {
									editor?.chain().focus().toggleHeading({ level: 3 }).run()
								}
							}}
							options={[
								{ label: 'Title', value: 'h1', style: { fontSize: '24px', fontWeight: 700 } },
								{ label: 'Heading', value: 'h2', style: { fontSize: '18px', fontWeight: 600 } },
								{ label: 'Subheading', value: 'h3', style: { fontSize: '14px', fontWeight: 600 } },
								{ label: 'Body', value: 'p', style: { fontSize: '14px', fontWeight: 400 } },
							]}
							triggerClassName="h-8 w-[140px] border-none bg-transparent hover:bg-black/5 dark:hover:bg-white/10 px-2 font-medium focus:ring-0"
							contentClassName="w-auto min-w-[160px] whitespace-nowrap"
						/>
					</div>

					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().undo().run()} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">undo</span></button>
						<button onClick={() => editor?.chain().focus().redo().run()} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">redo</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().toggleBold().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('bold') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_bold</span></button>
						<button onClick={() => editor?.chain().focus().toggleItalic().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('italic') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_italic</span></button>
						<button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('underline') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_underlined</span></button>
						<button onClick={() => editor?.chain().focus().toggleStrike().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('strike') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_strikethrough</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().setTextAlign('left').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'left' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_align_left</span></button>
						<button onClick={() => editor?.chain().focus().setTextAlign('center').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'center' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_align_center</span></button>
						<button onClick={() => editor?.chain().focus().setTextAlign('right').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'right' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_align_right</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('bulletList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_list_bulleted</span></button>
						<button onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('orderedList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">format_list_numbered</span></button>
						<button onClick={() => editor?.chain().focus().toggleTaskList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('taskList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}><span className="material-symbols-outlined text-[18px]">check_box</span></button>
						<button onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('blockquote') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Blockquote"><span className="material-symbols-outlined text-[18px]">format_quote</span></button>
						<button onClick={() => editor?.chain().focus().toggleCodeBlock().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('codeBlock') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Code Block"><span className="material-symbols-outlined text-[18px]">code_blocks</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md h-6 border-r border-black/10 dark:border-white/10">
						<button
							onClick={() => setIsLinkPromptOpen(true)}
							className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('link') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}
							title="Link"
						>
							<span className="material-symbols-outlined text-[18px]">link</span>
						</button>
						<ImageUploadButton onUpload={(url) => editor?.chain().focus().setImage({ src: url }).run()} />
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md h-6">
						<ColorHighlightPopover editor={editor} />
					</div>
					</div>
				) : (
					<div className="min-h-[40px] py-2 px-margin flex justify-center items-center bg-blue-500/10 border-y border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-semibold">
						<span className="material-symbols-outlined mr-2 text-base">visibility</span>
						You only have viewing access to this document.
					</div>
				)}
			</header>

			<div className="flex-1 flex overflow-hidden relative">
				{/* Main Workspace (Expanded, Dark Continuous Canvas) */}
				<main className={`flex-1 flex flex-col items-center bg-background relative scroll-smooth transition-all overflow-y-auto no-scrollbar py-8 ${isAIPanelOpen || isHistoryOpen ? 'lg:mr-80' : ''}`}>

					<div className={`editor-canvas w-full max-w-5xl min-h-[calc(100vh-12rem)] px-[40px] py-[20px] md:px-[60px] md:py-[40px] transition-all duration-300 relative group`}>
						{previewVersionName && (
							<div className='absolute top-4 left-4 flex items-center justify-between bg-primary/20 border border-primary/50 px-4 py-2 rounded-lg text-xs text-primary font-semibold backdrop-blur-md z-10'>
								<span>Previewing checkpoint: <span className='text-on-surface'>"{previewVersionName}"</span> (Read-Only)</span>
								<button onClick={() => { setPreviewDoc(null); setPreviewVersionName(null) }} className='flex items-center gap-1 hover:text-on-surface transition ml-4'>
									<EyeOff className='h-3.5 w-3.5' /> <span>Exit</span>
								</button>
							</div>
						)}

						<div className={previewDoc && previewEditor ? 'hidden' : 'block'}>
							{!isViewer && <AIBubbleMenu editor={editor} token={token} />}
							<EditorContent key="live" editor={editor} />
						</div>

						{previewDoc && previewEditor && (
							<div className="block">
								<EditorContent key={previewVersionName || 'preview'} editor={previewEditor} />
							</div>
						)}
					</div>
				</main>

				{/* Right Sidebar */}
				<AIAssistantPanel isOpen={isAIPanelOpen} onClose={() => setIsAIPanelOpen(false)} editor={editor} token={token} />

				<VersionHistory
					isOpen={isHistoryOpen}
					onClose={() => setIsHistoryOpen(false)}
					documentId={documentId}
					ydoc={ydoc}
					token={token}
					isViewer={isViewer}
					onPreviewVersion={(tempDoc, versionName) => {
						setPreviewDoc(tempDoc)
						setPreviewVersionName(versionName || null)
					}}
					onRestoreVersion={(tempDoc) => {
						if (!editor) return
						const headlessEditor = new Editor({
							extensions: [
								...getSharedExtensions(),
								Collaboration.configure({
									document: tempDoc,
								}),
							],
						})
						const content = headlessEditor.getHTML()
						editor.commands.setContent(content)
						headlessEditor.destroy()
					}}
				/>
			</div>

			<ShareModal
				isOpen={isShareOpen}
				onClose={() => setIsShareOpen(false)}
				documentId={documentId}
				documentTitle={title}
				userId={currentUser.id}
			/>

			<PromptDialog
				open={isLinkPromptOpen}
				onOpenChange={setIsLinkPromptOpen}
				title="Add Link"
				description="Enter the URL you want to link to. Leave empty to remove the link."
				placeholder="https://example.com"
				onSubmit={(url) => {
					if (url) {
						editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
					} else {
						editor?.chain().focus().unsetLink().run()
					}
				}}
				defaultValue={editor?.getAttributes('link').href || ''}
			/>
		</div>
	)
}
