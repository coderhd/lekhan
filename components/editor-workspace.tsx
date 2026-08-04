'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCursor } from '@/lib/collaboration-cursor'
import { FontFamily } from '@tiptap/extension-font-family'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { EyeOff } from 'lucide-react'
import tippy from 'tippy.js'
import { createRoot } from 'react-dom/client'
import { useEditorCollab } from '@/hooks/use-editor-collab'
import SyncIndicator from './sync-indicator'
import OfflineBanner from './offline-banner'
import { InlineEdit } from './inline-edit'
import ShareModal from './share-modal'
import VersionHistory from './version-history'
import MobileHeaderMenu from './mobile-header-menu'
import AISettingsPanel from './ai-settings-panel'
import AIBubbleMenu from './ai-bubble-menu'
import LekhanBotBar from './lekhan-bot-bar'
import AIDiffPreview from './ai-diff-preview'
import { SlashMenuExtension, buildSlashMenuItems } from '@/lib/slash-menu-extension'
import { SlashMenuComponent } from './slash-menu'
import ProfileMenu from './profile-menu'
import ThemeToggle from './theme-toggle'
import { ColorHighlightPopover } from './color-highlight-popover'
import { ImageUploadButton } from './image-upload-button'
import GlobalLoader from './global-loader'
import { CustomSelect } from './ui/custom-select'
import { PromptDialog } from './ui/prompt-dialog'
import * as Y from 'yjs'
import { Mention } from '@tiptap/extension-mention'
import MentionList, { MentionItem } from './mention-list'
import { fetchDocumentDetails, fetchMemberRole, updateDocumentTitle, fetchMentionableCollaborators, getUserAICredits } from '@/services/db'

import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { TableToolbar } from './table-toolbar'
import { CodeBlockLanguageSelect } from './code-block-language-select'
import { DragContextMenu } from './drag-context-menu'
import { exportToDocx, exportToPdf } from '@/lib/export-utils'
import PricingPlans from './pricing-plans'
import { Download, Sparkles, FileText, FileSpreadsheet } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'

const lowlight = createLowlight(common)

import { Document } from '@tiptap/extension-document'
import { Placeholder } from '@tiptap/extension-placeholder'

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

const CustomDocument = Document.extend({
	content: 'heading block*',
})

import { AnyExtension } from '@tiptap/core'
import { PersistentSelection } from '@/lib/persistent-selection'
import { decideMarkdownPaste } from '@/lib/markdown-paste'

const getSharedExtensions = (): AnyExtension[] => [
	CustomDocument,
	PersistentSelection,
	StarterKit.configure({
		document: false,
		codeBlock: false,
		link: false,
		underline: false,
		undoRedo: false,
	}),
	CodeBlockLowlight.configure({
		lowlight,
	}),
	Table.configure({
		resizable: true,
	}),
	TableRow,
	TableHeader,
	TableCell,
	Markdown.configure({
		html: true,
		transformPastedText: true,
		transformCopiedText: true,
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
	const [isLekhanBotOpen, setIsLekhanBotOpen] = useState(false)
	const [diffPreview, setDiffPreview] = useState<{
		actionId: string
		originalText: string
		resultText: string
		position: { x: number, y: number }
	} | null>(null)
	const [detectedLanguage, setDetectedLanguage] = useState<{
		code: string
		name: string
		script: string
	} | null>(null)
	const [isDetectingLanguage, setIsDetectingLanguage] = useState(false)
	const [mentionables, setMentionables] = useState<MentionItem[]>([])
	const [userPlan, setUserPlan] = useState<'free' | 'go' | 'pro' | 'team' | 'enterprise'>('free')
	const [isExporting, setIsExporting] = useState(false)
	const [isExportOpen, setIsExportOpen] = useState(false)
	const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false)

	useEffect(() => {
		let isCurrent = true
		const checkPlan = async () => {
			if (currentUser?.id) {
				try {
					const credits = await getUserAICredits(currentUser.id)
					if (isCurrent) {
						setUserPlan(credits.plan)
					}
				} catch (err) {
					console.error('Error fetching plan:', err)
				}
			}
		}
		checkPlan()
		return () => {
			isCurrent = false
		}
	}, [currentUser?.id])

	const handleExport = async (type: 'docx' | 'pdf') => {
		if (userPlan === 'free') {
			setIsUpgradeModalOpen(true)
			return
		}
		if (!editor) return
		setIsExporting(true)
		try {
			if (type === 'docx') {
				await exportToDocx(editor.getHTML(), title)
			} else if (type === 'pdf') {
				const editorEl = editor.view.dom as HTMLElement
				if (editorEl) {
					await exportToPdf(editorEl, title)
				}
			}
		} catch (err) {
			console.error('Export error:', err)
		} finally {
			setIsExporting(false)
			setIsExportOpen(false)
		}
	}


	useEffect(() => {
		const loadMentionables = async () => {
			try {
				const collabs = await fetchMentionableCollaborators(documentId)
				setMentionables(collabs.map(c => ({ id: c.id, name: c.full_name || c.email, email: c.email, avatarUrl: c.avatar_url })))
			} catch (err) {
				console.error('Error fetching mentionables:', err)
			}
		}
		if (documentId) {
			loadMentionables()
		}
	}, [documentId])

	const handleOpenLekhanBot = useCallback(() => {
		setDiffPreview(null)
		setIsLekhanBotOpen(true)
	}, [])




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
		isSynced,
		connectionState,
		isOffline,
		activeUsers,
		hasUnsyncedChanges,
		provider,
		isLocalSynced,
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
			...(ydoc && provider ? [
				CollaborationCursor.configure({
					provider: provider,
					user: {
						name: collabUser.name,
						color: collabUser.color,
					},
				}),
			] : []),
			SlashMenuExtension.configure({
				suggestion: {
					char: '/',
					items: ({ query }: { query: string }) => {
						const allItems = buildSlashMenuItems(handleOpenLekhanBot)
						if (!query) return allItems
						// Exact id match takes priority — typing "/l" should
						// resolve straight to "Ask Lekhan Bot" (consistent with
						// the Cmd/Ctrl+L shortcut) rather than getting diluted
						// by other items whose labels merely contain the
						// letter "l" (e.g. "Bullet List", "Numbered List").
						const exactIdMatch = allItems.find(item => item.id === query.toLowerCase())
						if (exactIdMatch) return [exactIdMatch]
						return allItems.filter(item =>
							item.label.toLowerCase().includes(query.toLowerCase())
						)
					},
					render: () => {
						let component: any
						let popup: any

						return {
							onStart: (props: any) => {
								const container = document.createElement('div')
								const root = createRoot(container)
								component = { root, container, ref: { current: null } }

								const renderMenu = (items: any[], command: any) => {
									root.render(
										<SlashMenuComponent
											ref={(r: any) => { component.ref.current = r }}
											items={items}
											command={command}
										/>
									)
								}

								renderMenu(props.items, props.command)

								popup = tippy('body', {
									getReferenceClientRect: props.clientRect,
									appendTo: () => document.body,
									content: container,
									showOnCreate: true,
									interactive: true,
									trigger: 'manual',
									placement: 'bottom-start',
								})
							},
							onUpdate: (props: any) => {
								if (!component) return
								const renderMenu = (items: any[], command: any) => {
									component.root.render(
										<SlashMenuComponent
											ref={(r: any) => { component.ref.current = r }}
											items={items}
											command={command}
										/>
									)
								}
								renderMenu(props.items, props.command)
								popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
							},
							onKeyDown: (props: any) => {
								if (props.event.key === 'Escape') {
									popup?.[0]?.hide()
									return true
								}
								return component?.ref?.current?.onKeyDown(props) || false
							},
							onExit: () => {
								popup?.[0]?.destroy()
								component?.root?.unmount()
							},
						}
					},
				},
			}),
			Mention.configure({
				HTMLAttributes: {
					class: 'mention',
				},
				suggestion: {
					items: ({ query }: { query: string }) => {
						if (!query) return mentionables
						return mentionables.filter(item =>
							item.name.toLowerCase().includes(query.toLowerCase()) ||
							(item.email && item.email.toLowerCase().includes(query.toLowerCase()))
						)
					},
					render: () => {
						let component: any
						let popup: any

						return {
							onStart: (props: any) => {
								const container = document.createElement('div')
								const root = createRoot(container)
								component = { root, container, ref: { current: null } }

								const renderMenu = (items: any[], command: any) => {
									root.render(
										<MentionList
											ref={(r: any) => { component.ref.current = r }}
											items={items}
											command={command}
										/>
									)
								}

								renderMenu(props.items, props.command)

								popup = tippy('body', {
									getReferenceClientRect: props.clientRect,
									appendTo: () => document.body,
									content: container,
									showOnCreate: true,
									interactive: true,
									trigger: 'manual',
									placement: 'bottom-start',
								})
							},
							onUpdate: (props: any) => {
								if (!component) return
								const renderMenu = (items: any[], command: any) => {
									component.root.render(
										<MentionList
											ref={(r: any) => { component.ref.current = r }}
											items={items}
											command={command}
										/>
									)
								}
								renderMenu(props.items, props.command)
								popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
							},
							onKeyDown: (props: any) => {
								if (props.event.key === 'Escape') {
									popup?.[0]?.hide()
									return true
								}
								return component?.ref?.current?.onKeyDown(props) || false
							},
							onExit: () => {
								popup?.[0]?.destroy()
								component?.root?.unmount()
							},
						}
					},
				},
			}),
		],

		editorProps: {
			attributes: {
				class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[500px] text-on-surface break-words w-full',
			},
			handlePaste: (_view, event) => {
				// Use the live editor instance. useEditor may recreate the editor
				// when [ydoc, provider] deps change (async collab setup), so the
				// closure's `editor` binding can be a stale, destroyed instance
				// whose storage (markdown parser) is empty.
				const currentEditor = editorRef.current ?? editor
				if (!currentEditor) return false

				const plainText = event.clipboardData?.getData('text/plain')
				const htmlText = event.clipboardData?.getData('text/html')

				if (!plainText || currentEditor.isActive('codeBlock')) {
					return false
				}

				const kind = decideMarkdownPaste(plainText, htmlText)

				if (kind === 'markdown') {
					const parser = (currentEditor as any).storage?.markdown?.parser
					if (parser) {
						const parsedHtml = parser.parse(plainText)
						if (parsedHtml) {
							event.preventDefault()
							if (currentEditor.isEmpty || currentEditor.getText().trim() === '') {
								currentEditor.commands.setContent(parsedHtml)
							} else {
								currentEditor.commands.insertContent(parsedHtml)
							}
							return true
						}
					}
					return false
				}

				if (kind === 'codeBlock') {
					event.preventDefault()
					currentEditor.commands.insertContent({
						type: 'codeBlock',
						content: [{ type: 'text', text: plainText }],
					})
					return true
				}

				return false
			},
		},
		editable: !isViewer,
		immediatelyRender: false,
	}, [ydoc, provider])

	// Tiptap's useEditor can recreate the editor instance when the
	// [ydoc, provider] deps change (async collab setup). editorProps closures
	// like handlePaste can therefore capture a stale, destroyed editor whose
	// extension storage (e.g. markdown parser) is empty. Keep a ref to the
	// live editor so paste always reads the current instance.
	const editorRef = useRef<Editor | null>(null)
	editorRef.current = editor

	const handleLekhanBotResult = useCallback((
		actionId: string,
		result: string,
		originalText: string,
	) => {
		if (!editor) return
		const { to } = editor.state.selection
		const coords = editor.view.coordsAtPos(to)
		setDiffPreview({
			actionId,
			originalText,
			resultText: result,
			position: {
				x: coords.left,
				y: coords.bottom + 8,
			},
		})
	}, [editor])

	// Document-level language detection (debounced on content change)
	useEffect(() => {
		if (!editor || isViewer) return

		const detectDocumentLanguage = async () => {
			const text = editor.getText().trim()
			if (!text || text.length < 5) {
				setDetectedLanguage(null)
				return
			}
			setIsDetectingLanguage(true)
			try {
				const res = await fetch('/api/ai', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ action: 'detect-language', text: text.slice(0, 2000) }),
				})
				if (res.ok) {
					const data = await res.json()
					if (data.languageCode) {
						setDetectedLanguage({
							code: data.languageCode,
							name: data.languageName || data.languageCode,
							script: data.script || 'Latin',
						})
					}
				}
			} catch {
				// Silent fallback
			} finally {
				setIsDetectingLanguage(false)
			}
		}

		const timer = setTimeout(detectDocumentLanguage, 1200)
		return () => clearTimeout(timer)
	}, [editor, token, isViewer])

	// Cmd/Ctrl+L opens the Lekhan Bot bar
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
				e.preventDefault()
				handleOpenLekhanBot()
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [handleOpenLekhanBot])

	useEffect(() => {
		if (editor && isViewer !== null) {
			editor.setEditable(!isViewer)
		}
	}, [editor, isViewer])

	useEffect(() => {
		if (editor) {
			editor.commands.setBotActive(isLekhanBotOpen)
		}
	}, [editor, isLekhanBotOpen])

	const handleSaveTitle = async (newTitle: string) => {
		setTitle(newTitle)
		await updateDocumentTitle(documentId, newTitle)
	}

	if (!ydoc || !editor || isViewer === null || !isLocalSynced) {
		return <GlobalLoader text="Loading workspace..." />
	}


	return (
		<div className="bg-background text-on-background font-body-md selection:bg-primary-container selection:text-on-primary-container h-screen overflow-hidden flex flex-col">
			{/* Redesigned Top Header and Integrated Toolbar */}
			<header className="flex-none w-full z-50 bg-surface-container/80 backdrop-blur-xl border-b border-black/10 dark:border-white/10 flex flex-col">
				{/* Row 1: App Controls & Document Title */}
				<div className="h-14 px-6 md:px-10 flex justify-between items-center border-b border-white/5">
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
						<div className="hidden md:flex items-center gap-xs ml-2 text-on-surface-variant/60 font-label-sm text-label-sm">
							<SyncIndicator connectionState={connectionState} isSynced={isSynced} />
						</div>
					</div>

					<div className="flex items-center gap-sm md:gap-md">
						<div className="hidden sm:flex -space-x-2 items-center mr-2 md:mr-4">
							{activeUsers.slice(0, 3).map((activeUser, idx) => (
								<div
									key={idx}
									style={{ backgroundColor: activeUser.color, color: '#ffffff' }}
									className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-container-low shadow-sm text-[10px] font-bold select-none relative z-10 hover:z-20 hover:scale-110 transition-transform"
									title={activeUser.name}
								>
									{getInitials(activeUser.name)}
								</div>
							))}
							{activeUsers.length > 3 && (
								<div className="relative group z-0">
									<div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-container-low bg-surface-container-high text-on-surface shadow-sm text-[10px] font-bold select-none cursor-pointer hover:z-20 hover:scale-110 transition-transform">
										+{activeUsers.length - 3}
									</div>
									<div className="absolute top-full right-0 pt-2 w-max min-w-[160px] hidden group-hover:flex flex-col z-50 animate-in fade-in zoom-in-95">
										<div className="bg-surface-container-high border border-black/10 dark:border-white/10 rounded-xl shadow-xl p-3 gap-2 flex flex-col">
											<div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">More Collaborators</div>
											{activeUsers.slice(3).map((activeUser, idx) => (
												<div key={idx} className="flex items-center gap-2">
													<div
														style={{ backgroundColor: activeUser.color, color: '#ffffff' }}
														className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold select-none shadow-sm"
													>
														{getInitials(activeUser.name)}
													</div>
													<span className="text-sm font-medium text-on-surface truncate">{activeUser.name}</span>
												</div>
											))}
										</div>
									</div>
								</div>
							)}
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
							title="Settings"
						>
							<span className="material-symbols-outlined text-primary-container text-lg">settings</span>
							<span className="hidden lg:inline">Settings</span>
						</button>

						<MobileHeaderMenu
							isHistoryOpen={isHistoryOpen}
							setIsHistoryOpen={setIsHistoryOpen}
							isAIPanelOpen={isAIPanelOpen}
							setIsAIPanelOpen={setIsAIPanelOpen}
							theme={theme}
							toggleTheme={toggleTheme}
							activeUsers={activeUsers}
							connectionState={connectionState}
							isSynced={isSynced}
						/>

						{!isViewer && (
							<div className="flex items-center gap-sm">
								<div className="relative">
									<button
										type="button"
										disabled={isExporting}
										onClick={() => setIsExportOpen(prev => !prev)}
										onKeyDown={(e) => {
											if (e.key === 'Escape') setIsExportOpen(false)
										}}
										aria-haspopup="menu"
										aria-expanded={isExportOpen}
										className="bg-surface-container-low border border-black/10 dark:border-white/10 text-on-surface px-2.5 h-8 rounded-lg font-medium text-xs hover:bg-black/5 dark:hover:bg-white/10 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:pointer-events-none"
										title="Export Document"
									>
										<Download className="w-3.5 h-3.5 text-primary" />
										<span className="hidden lg:inline font-bold">Export</span>
										{userPlan === 'free' && (
											<span className="text-[10px] bg-primary/20 text-primary px-1 rounded font-semibold">
												PRO
											</span>
										)}
									</button>

									{isExportOpen && (
										<div className="absolute top-full right-0 pt-1.5 w-44 z-50 animate-in fade-in zoom-in-95" role="menu">
											<div className="bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-1 shadow-xl flex flex-col gap-0.5 text-xs">
												<button
													type="button"
													disabled={isExporting}
													onClick={() => handleExport('docx')}
													className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 text-left transition-colors font-medium w-full disabled:opacity-50 disabled:pointer-events-none"
													role="menuitem"
												>
													<FileSpreadsheet className="w-4 h-4 text-blue-500" />
													<span>Download as DOCX</span>
												</button>
												<button
													type="button"
													disabled={isExporting}
													onClick={() => handleExport('pdf')}
													className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 text-left transition-colors font-medium w-full disabled:opacity-50 disabled:pointer-events-none"
													role="menuitem"
												>
													<FileText className="w-4 h-4 text-red-500" />
													<span>Download as PDF</span>
												</button>
											</div>
										</div>
									)}
								</div>

								<button
									onClick={() => setIsShareOpen(true)}
									className="bg-primary-container text-on-primary-container px-2 lg:px-4 h-8 rounded-lg font-bold text-sm hover:brightness-110 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-xs"
								>
									<span className="material-symbols-outlined text-lg">share</span>
									<span className="hidden lg:inline">Share</span>
								</button>
							</div>
						)}

						<div className="hidden md:block">
							<ThemeToggle />
						</div>

						<div>
							<ProfileMenu user={currentUser} size="sm" />
						</div>
					</div>
				</div>

				{/* Row 2: Formatting Toolbar or Read Only Banner */}
				{!isViewer ? (
					<div className={`min-h-[40px] py-2 px-6 md:px-10 flex flex-nowrap overflow-x-auto hide-scrollbar justify-start xl:justify-center items-center bg-surface-container-low border-y border-black/10 dark:border-white/10 ${previewDoc ? 'opacity-40 pointer-events-none' : ''}`}>

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
						<button onClick={() => editor?.chain().focus().undo().run()} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center" title="Undo"><span className="material-symbols-outlined text-[18px]">undo</span></button>
						<button onClick={() => editor?.chain().focus().redo().run()} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors text-on-surface-variant hover:text-on-surface flex items-center justify-center" title="Redo"><span className="material-symbols-outlined text-[18px]">redo</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().toggleBold().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('bold') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Bold"><span className="material-symbols-outlined text-[18px]">format_bold</span></button>
						<button onClick={() => editor?.chain().focus().toggleItalic().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('italic') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Italic"><span className="material-symbols-outlined text-[18px]">format_italic</span></button>
						<button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('underline') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Underline"><span className="material-symbols-outlined text-[18px]">format_underlined</span></button>
						<button onClick={() => editor?.chain().focus().toggleStrike().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('strike') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Strike"><span className="material-symbols-outlined text-[18px]">format_strikethrough</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().setTextAlign('left').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'left' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Align Left"><span className="material-symbols-outlined text-[18px]">format_align_left</span></button>
						<button onClick={() => editor?.chain().focus().setTextAlign('center').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'center' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Align Center"><span className="material-symbols-outlined text-[18px]">format_align_center</span></button>
						<button onClick={() => editor?.chain().focus().setTextAlign('right').run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive({ textAlign: 'right' }) ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Align Right"><span className="material-symbols-outlined text-[18px]">format_align_right</span></button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md border-r border-black/10 dark:border-white/10 h-6">
						<button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('bulletList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Bullet List"><span className="material-symbols-outlined text-[18px]">format_list_bulleted</span></button>
						<button onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('orderedList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Ordered List"><span className="material-symbols-outlined text-[18px]">format_list_numbered</span></button>
						<button onClick={() => editor?.chain().focus().toggleTaskList().run()} className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('taskList') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`} title="Task List"><span className="material-symbols-outlined text-[18px]">check_box</span></button>
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
						<button
							onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
							className={`p-1 rounded transition-colors flex items-center justify-center ${editor?.isActive('table') ? 'text-primary bg-primary/10' : 'text-on-surface hover:bg-black/5 dark:hover:bg-white/10'}`}
							title="Insert Table"
						>
							<span className="material-symbols-outlined text-[18px]">table</span>
						</button>
					</div>
					<div className="flex shrink-0 items-center gap-xs px-md h-6">
						<ColorHighlightPopover editor={editor} />
					</div>
					</div>
				) : (
					<div className="min-h-[40px] py-2 px-6 md:px-10 flex justify-center items-center bg-blue-500/10 border-y border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-semibold">
						<span className="material-symbols-outlined mr-2 text-base">visibility</span>
						You only have viewing access to this document.
					</div>
				)}

				{/* Row 3: Offline Warning — shown regardless of viewer/toolbar row above */}
				{isOffline && <OfflineBanner />}
			</header>

			<div className="flex-1 flex overflow-hidden relative">
				{/* Main Workspace (Expanded, Dark Continuous Canvas) */}
				<main className={`flex-1 flex flex-col items-center bg-background relative scroll-smooth transition-all overflow-y-auto no-scrollbar py-8 pb-36 ${isAIPanelOpen || isHistoryOpen ? 'lg:mr-80' : ''}`}>

					{!isViewer && editor && (
						<div className="sticky top-2 z-30 flex items-center justify-center gap-2 mb-2">
							<TableToolbar editor={editor} />
						</div>
					)}

					<div className={`editor-canvas w-full max-w-5xl min-h-[calc(100vh-12rem)] px-[40px] py-[20px] md:px-[60px] md:py-[40px] transition-all duration-300 relative group`}>
						{!isViewer && editor && <DragContextMenu editor={editor} />}

						{previewVersionName && (
							<div className='absolute top-4 left-4 flex items-center justify-between bg-primary/20 border border-primary/50 px-4 py-2 rounded-lg text-xs text-primary font-semibold backdrop-blur-md z-10'>
								<span>Previewing checkpoint: <span className='text-on-surface'>"{previewVersionName}"</span> (Read-Only)</span>
								<button onClick={() => { setPreviewDoc(null); setPreviewVersionName(null) }} className='flex items-center gap-1 hover:text-on-surface transition ml-4'>
									<EyeOff className='h-3.5 w-3.5' /> <span>Exit</span>
								</button>
							</div>
						)}

						<div className={previewDoc && previewEditor ? 'hidden' : 'block'}>
							{!isViewer && <AIBubbleMenu editor={editor} onOpenLekhanBot={handleOpenLekhanBot} />}
							{!isViewer && <CodeBlockLanguageSelect editor={editor} />}
							<EditorContent key="live" editor={editor} />
						</div>

						{previewDoc && previewEditor && (
							<div className="block">
								<EditorContent key={previewVersionName || 'preview'} editor={previewEditor} />
							</div>
						)}
					</div>
				</main>

				{!isViewer && (
					<LekhanBotBar
						editor={editor}
						token={token}
						isVisible={isLekhanBotOpen}
						onClose={() => setIsLekhanBotOpen(false)}
						onResult={handleLekhanBotResult}
						detectedLanguage={detectedLanguage}
					/>
				)}

				{diffPreview && (
					<AIDiffPreview
						editor={editor}
						actionId={diffPreview.actionId}
						originalText={diffPreview.originalText}
						resultText={diffPreview.resultText}
						position={diffPreview.position}
						onClose={() => setDiffPreview(null)}
					/>
				)}

				<AISettingsPanel
					isOpen={isAIPanelOpen}
					onClose={() => setIsAIPanelOpen(false)}
					editor={editor}
					token={token}
					detectedLanguage={detectedLanguage}
					isDetecting={isDetectingLanguage}
				/>


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

			<Dialog.Root open={isUpgradeModalOpen} onOpenChange={setIsUpgradeModalOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] animate-in fade-in" />
					<Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface-container max-w-4xl w-[92vw] max-h-[90vh] overflow-y-auto rounded-2xl border border-black/10 dark:border-white/10 p-6 shadow-2xl z-[100000] animate-in zoom-in-95">
						<div className="flex items-center justify-between mb-2">
							<div className="flex items-center gap-2">
								<Sparkles className="w-5 h-5 text-primary" />
								<h3 className="text-lg font-bold text-on-surface">Upgrade to Premium</h3>
							</div>
							<Dialog.Close className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
								<span className="material-symbols-outlined text-lg">close</span>
							</Dialog.Close>
						</div>
						<p className="text-sm text-on-surface-variant mb-6">
							Exporting documents as DOCX or PDF is a premium feature available on Go, Pro, Team, and Enterprise plans. Upgrade today to unlock document exports, unlimited documents, and higher AI limits!
						</p>
						<PricingPlans currentPlan={userPlan} />
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</div>
	)
}

