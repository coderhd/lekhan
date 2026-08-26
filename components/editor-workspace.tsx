'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, Editor, ReactNodeViewRenderer } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCursor } from '@/lib/collaboration-cursor'
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
import { useGlobalSearch } from '@/components/global-search-palette'
import { ColorHighlightPopover } from './color-highlight-popover'
import { ImageUploadButton } from './image-upload-button'
import GlobalLoader from './global-loader'
import { CustomSelect } from './ui/custom-select'
import { PromptDialog } from './ui/prompt-dialog'
import * as Y from 'yjs'
import { Mention } from '@tiptap/extension-mention'
import MentionList, { MentionItem } from './mention-list'
import { fetchPageDetails, fetchPageMemberRole, updatePageTitle, fetchMentionablePageCollaborators, fetchPageTags } from '@/services/graph'

import { TableToolbar } from './table-toolbar'
import { CodeBlockLanguageSelect } from './code-block-language-select'
import { DragContextMenu } from './drag-context-menu'
import { exportToDocx, exportToPdf, downloadBlob } from '@/lib/export-utils'
import { buildMarkdownExport, exportFilename, serializeExportBodyMarkdown, serializeExportBodyHtml, buildStandaloneHtml } from '@/lib/markdown-export'
import { Download, FileText, FileSpreadsheet, FileCode, Globe, type LucideIcon } from 'lucide-react'
import { track } from '@/lib/analytics'

type ExportType = 'markdown' | 'mdx' | 'html' | 'docx' | 'pdf'

const EXPORT_MENU_ITEMS: { type: ExportType; label: string; icon: LucideIcon; iconClass: string }[] = [
	{ type: 'markdown', label: 'Download as Markdown (.md)', icon: FileCode, iconClass: 'text-emerald-500' },
	{ type: 'mdx', label: 'Download as MDX (.mdx)', icon: FileCode, iconClass: 'text-purple-500' },
	{ type: 'html', label: 'Download as HTML (.html)', icon: Globe, iconClass: 'text-orange-500' },
	{ type: 'docx', label: 'Download as DOCX', icon: FileSpreadsheet, iconClass: 'text-blue-500' },
	{ type: 'pdf', label: 'Download as PDF', icon: FileText, iconClass: 'text-red-500' },
]

interface EditorWorkspaceProps {
	pageId: string
	initialTitle: string
	token: string
	initialContent?: string | null
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

import { getSharedExtensions } from '@/lib/editor-extensions'
import { decideMarkdownPaste } from '@/lib/markdown-paste'
import { insertParsedHtml } from '@/lib/insert-parsed-html'
import { hydrateOnOpen } from '@/lib/import-hydration'
import { Callout, BLOCKQUOTE_MARKER_RE, handleCalloutInputRule } from '@/lib/callout'
import { CalloutNodeView } from './callout-node-view'
import { InputRule } from '@tiptap/core'

const LiveCallout = Callout.extend({
	addNodeView() {
		return ReactNodeViewRenderer(CalloutNodeView)
	},
	addInputRules() {
		return [new InputRule({ find: BLOCKQUOTE_MARKER_RE, handler: handleCalloutInputRule })]
	},
})

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

export default function EditorWorkspace({	pageId,
	initialTitle,
	token,
	initialContent,
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
	const [ownerId, setOwnerId] = useState<string | null>(null)
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
	const [isExporting, setIsExporting] = useState(false)
	const [isExportOpen, setIsExportOpen] = useState(false)

	useEffect(() => {
		const loadMentionables = async () => {
			try {
				const collabs = await fetchMentionablePageCollaborators(pageId)
				setMentionables(collabs.map(c => ({ id: c.id, name: c.full_name || c.email, email: c.email, avatarUrl: c.avatar_url })))
			} catch (err) {
				console.error('Error fetching mentionables:', err)
			}
		}
		if (pageId) {
			loadMentionables()
		}
	}, [pageId])

	const handleExport = async (type: ExportType) => {
		if (!editor) return
		setIsExporting(true)
		track('export_triggered', { format: type })
		try {
			if (type === 'markdown' || type === 'mdx') {
				const [pageDetails, pageTags] = await Promise.all([
					fetchPageDetails(pageId),
					fetchPageTags(pageId),
				])
				const file = buildMarkdownExport({
					title,
					properties: pageDetails.properties || {},
					pageTags: pageTags.map((t) => t.tag),
					body: serializeExportBodyMarkdown(editor.getJSON()),
				})
				const extension = type === 'mdx' ? 'mdx' : 'md'
				downloadBlob(new Blob([file], { type: 'text/markdown;charset=utf-8' }), exportFilename(title, extension))
			} else if (type === 'html') {
				const html = buildStandaloneHtml(serializeExportBodyHtml(editor.getJSON()), title)
				downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), exportFilename(title, 'html'))
			} else if (type === 'docx') {
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

	const handleOpenLekhanBot = useCallback(() => {
		setDiffPreview(null)
		setIsLekhanBotOpen(true)
	}, [])

	const { open: openGlobalSearch } = useGlobalSearch()




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
				const page = await fetchPageDetails(pageId)
				setOwnerId(page.owner_id)
				if (page && page.owner_id === currentUser.id) {
					setIsViewer(false)
					return
				}

				const role = await fetchPageMemberRole(pageId, currentUser.id)
				if (role === 'editor' || role === 'owner') {
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
	}, [pageId, currentUser.id])

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
	} = useEditorCollab(pageId, token, collabUser)

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
			...getSharedExtensions().map((ext) => (ext.name === 'callout' ? LiveCallout : ext)),
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
							track('paste_in_resolved', { kind: 'markdown' })
							// parsedHtml is already HTML — see lib/insert-parsed-html.ts:
							// the markdown command overrides would re-parse it as markdown.
							const replaceDocument = currentEditor.isEmpty || currentEditor.getText().trim() === ''
							insertParsedHtml(currentEditor, parsedHtml, { replaceDocument })
							return true
						}
					}
					return false
				}

				if (kind === 'codeBlock') {
					event.preventDefault()
					track('paste_in_resolved', { kind: 'codeBlock' })
					currentEditor.commands.insertContent({
						type: 'codeBlock',
						content: [{ type: 'text', text: plainText }],
					})
					return true
				}

				return false
			},
		},
		onUpdate: () => {
			try {
				const today = new Date().toISOString().slice(0, 10)
				const storageKey = currentUser?.id ? `lekhan_last_edit_date_${currentUser.id}` : 'lekhan_last_edit_date'
				const lastEdit = localStorage.getItem(storageKey)
				if (lastEdit !== today) {
					localStorage.setItem(storageKey, today)
					track('daily_active_edit')
				}
			} catch {
				// Safe ignore
			}
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

	// Keep the ref in sync after commit instead of mutating it during render.
	// handlePaste reads editorRef.current inside a user event (post-commit), so
	// the live editor is always the committed one. Cleanup only clears the ref
	// when it still references the same editor instance, so a newer assignment
	// (e.g. editor recreated by useEditor dep changes) is never clobbered.
	useLayoutEffect(() => {
		editorRef.current = editor
		return () => {
			if (editorRef.current === editor) {
				editorRef.current = null
			}
		}
	}, [editor])

	// Hydrate an imported markdown payload into a freshly-created page. Runs
	// only after the collab doc is locally synced (so the doc reflects what is
	// actually persisted) and only once per mount: a page the user already has
	// content in is never clobbered, and useEditor recreating the instance when
	// ydoc/provider arrive must not re-run the hydration.
	const hydratedRef = useRef(false)
	useEffect(() => {
		if (hydratedRef.current) return
		if (!editor || !ydoc || !isLocalSynced) return
		if (hydrateOnOpen(editor, initialContent)) {
			hydratedRef.current = true
		}
	}, [editor, ydoc, isLocalSynced, initialContent])

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
		await updatePageTitle(pageId, newTitle)
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
							onClick={openGlobalSearch}
							className="hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium bg-surface-container-low"
							title="Search (Cmd+K)"
						>
							<span className="material-symbols-outlined text-primary-container text-lg">search</span>
						</button>

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
									</button>

									{isExportOpen && (
										<div className="absolute top-full right-0 pt-1.5 w-52 z-50 animate-in fade-in zoom-in-95" role="menu">
											<div className="bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-1 shadow-xl flex flex-col gap-0.5 text-xs">
												{EXPORT_MENU_ITEMS.map((item) => {
													const Icon = item.icon
													return (
														<button
															key={item.type}
															type="button"
															disabled={isExporting}
															onClick={() => handleExport(item.type)}
															className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-on-surface hover:bg-black/5 dark:hover:bg-white/10 text-left transition-colors font-medium w-full disabled:opacity-50 disabled:pointer-events-none"
															role="menuitem"
														>
															<Icon className={`w-4 h-4 ${item.iconClass}`} />
															<span>{item.label}</span>
														</button>
													)
												})}
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
					documentId={pageId}
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
				documentId={pageId}
				documentTitle={title}
				userId={currentUser.id}
				isOwner={currentUser.id === ownerId}
			/>

			<PromptDialog
				open={isLinkPromptOpen}
				onOpenChange={setIsLinkPromptOpen}
				title="Add Link"
				description="Enter the URL you want to link to. Leave empty to remove the link."
				placeholder="https://example.com"
				onSubmit={(url) => {
					if (url) {
						track('link_created')
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

