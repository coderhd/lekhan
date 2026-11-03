'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent, Editor, ReactNodeViewRenderer } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCursor } from '@/lib/collaboration-cursor'
import { EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import tippy from 'tippy.js'
import { createRoot } from 'react-dom/client'
import { useEditorCollab } from '@/hooks/use-editor-collab'
import SyncIndicator from './sync-indicator'
import OfflineBanner from './offline-banner'
import { InlineEdit } from './inline-edit'
import ShareModal from './share-modal'
import { VersionDrawer } from './version-history/version-drawer'
import { VersionHistoryEngine } from '@/lib/version-history/engine'
import { IndexedDBHistoryAdapter } from '@/lib/version-history/adapters/indexeddb'
import MobileHeaderMenu from './mobile-header-menu'
import AISettingsPanel from './ai-settings-panel'
import AIBubbleMenu from './ai-bubble-menu'
import LekhanBotBar from './lekhan-bot-bar'
import AIDiffPreview from './ai-diff-preview'
import { SlashMenuExtension, buildSlashMenuItems } from '@/lib/slash-menu-extension'
import { SlashMenuComponent } from './slash-menu'
import ProfileMenu from './profile-menu'
import ThemeToggle from './theme-toggle'
import PublicPageFooter from './public-page-footer'
import { useGlobalSearch } from '@/components/global-search-palette'
import GlobalLoader from './global-loader'
import { PromptDialog } from './ui/prompt-dialog'
import * as Y from 'yjs'
import { Mention } from '@tiptap/extension-mention'
import MentionList, { type MentionItem } from './mention-list'
import WikilinkList from './wikilink-list'
import { fetchPageDetails, fetchPageMemberRole, updatePageTitle, updatePageProperties, fetchMentionablePageCollaborators, fetchPageTags, fetchWorkspacePages, createPage } from '@/services/graph'
import { Wikilink, buildWikilinkSuggestions, exitWikilinkSuggestion, type WorkspacePageSummary, normalizeWikilinkTarget } from '@/lib/wikilink'
import { InboxTriage } from '@/lib/inbox-triage-extension'
import { type InboxRow } from '@/lib/inbox-triage'
import { InboxTriageError, linkInboxRow, tagInboxRow } from '@/lib/inbox-triage-actions'
import InboxTriageDialog, { type InboxTriageMode } from './inbox-triage-dialog'
import type { SearchResult } from '@/types'

import { TableToolbar } from './table-toolbar'
import { EditorToolbar } from './editor-toolbar'
import { CodeBlockLanguageSelect } from './code-block-language-select'
import { DragContextMenu } from './drag-context-menu'
import { exportToDocx, exportToPdf, downloadBlob } from '@/lib/export-utils'
import { buildMarkdownExport, exportFilename, serializeExportBodyMarkdown, serializeExportBodyHtml, buildStandaloneHtml } from '@/lib/markdown-export'
import { Download, Copy as CopyIcon, FileText, FileSpreadsheet, FileCode, Globe, type LucideIcon } from 'lucide-react'
import { track } from '@/lib/analytics'

type ExportType = 'markdown' | 'html' | 'docx' | 'pdf'

const EXPORT_MENU_ITEMS: { type: ExportType; label: string; icon: LucideIcon; iconClass: string }[] = [
	{ type: 'markdown', label: 'Download as Markdown (.md)', icon: FileCode, iconClass: 'text-emerald-500' },
	{ type: 'html', label: 'Download as HTML (.html)', icon: Globe, iconClass: 'text-orange-500' },
	{ type: 'docx', label: 'Download as DOCX', icon: FileSpreadsheet, iconClass: 'text-blue-500' },
	{ type: 'pdf', label: 'Download as PDF', icon: FileText, iconClass: 'text-red-500' },
]

// Explicit copy-out affordances (SIL-59): a single automatic payload cannot
// serve both targets — Obsidian prefers `text/html` when present and would drop
// frontmatter/degrade callouts, so it needs the plain Obsidian markdown alone.
const COPY_MENU_ITEMS: { target: ClipboardTarget; label: string; icon: LucideIcon; iconClass: string }[] = [
	{ target: 'obsidian', label: 'Copy as Obsidian markdown', icon: CopyIcon, iconClass: 'text-violet-500' },
	{ target: 'notion', label: 'Copy for Notion (rich)', icon: CopyIcon, iconClass: 'text-pink-500' },
]

// GV-T3: the backlink drawer is split out and only mounted when opened, so the
// editor bundle does not pay for the pane on every page load.
const BacklinkPane = dynamic(() => import('./backlink-pane'), { ssr: false })

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
	/**
	 * True when the route granted a synthetic anonymous session (signed-out
	 * visitor on a public page). Drives the public reading chrome: reduced
	 * header, Public badge, footer signup CTA. Never inferred from `isViewer`
	 * — a member viewer is a different experience.
	 */
	anonVisitor?: boolean
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
import { classifyClipboardPaste } from '@/lib/markdown-paste'
import { splitObsidianFrontmatter } from '@/lib/obsidian-clipboard'
import { notionHtmlToMarkdown } from '@/lib/notion-clipboard'
import { insertParsedHtml } from '@/lib/insert-parsed-html'
import { hydrateOnOpen } from '@/lib/import-hydration'
import { Callout, BLOCKQUOTE_MARKER_RE, handleCalloutInputRule } from '@/lib/callout'
import { CalloutNodeView } from './callout-node-view'
import { buildClipboardPayload, writeClipboardPayload, copyClipboardPayloadToSystem, type ClipboardTarget } from '@/lib/markdown/clipboard'
import { InputRule, type JSONContent } from '@tiptap/core'

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
	anonVisitor = false,
}: EditorWorkspaceProps) {
	const router = useRouter()
	const [title, setTitle] = useState(initialTitle)
	const [inboxTriage, setInboxTriage] = useState<{ mode: InboxTriageMode; row: InboxRow } | null>(null)
	const [inboxBusy, setInboxBusy] = useState(false)
	const inboxBusyRef = useRef(false)
	const inboxScrollDoneRef = useRef(false)
	const inboxScrollCancelledRef = useRef(false)
	// The editor is created with the extension configured once; keep the
	// callbacks stable and read the latest state through this ref.
	const inboxCallbacksRef = useRef<{
		onLink: (row: InboxRow) => void
		onTag: (row: InboxRow) => void
	}>({ onLink: () => {}, onTag: () => {} })

	useEffect(() => {
		inboxCallbacksRef.current = {
			onLink: row => setInboxTriage({ mode: 'link', row }),
			onTag: row => setInboxTriage({ mode: 'tag', row }),
		}
	}, [])
	const [userColor] = useState(() => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)])
	const [isShareOpen, setIsShareOpen] = useState(false)
	const [isHistoryOpen, setIsHistoryOpen] = useState(false)
	const [isAIPanelOpen, setIsAIPanelOpen] = useState(false)
	const [isBacklinksOpen, setIsBacklinksOpen] = useState(false)
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
	const [workspaceId, setWorkspaceId] = useState<string | null>(null)
	const [workspacePages, setWorkspacePages] = useState<WorkspacePageSummary[]>([])
	// Live read for the `[[` popup items callback: the editor is created once
	// per [ydoc, provider] cycle, so state would be stale inside the
	// Suggestion closure; ref keeps suggestions current without recreating
	// the editor on every page fetch.
	const workspacePagesRef = useRef<WorkspacePageSummary[]>([])
	// Sync via layout effect, not render (CodeRabbit #187 finding): a
	// discarded render would otherwise leave the ref pointing at data that
	// never committed. The `items` callback only runs from editor events
	// after commit, so this is safe. (Same hazard the repo documents for
	// pageIdRef below.)
	useLayoutEffect(() => {
		workspacePagesRef.current = workspacePages
	}, [workspacePages])

	// Live Page metadata for clipboard copy-out (S3). The copy handler is
	// synchronous, so title/tags/properties are mirrored into a ref rather than
	// read from state (which would be stale inside the editorProps closure).
	const clipboardMetaRef = useRef<{ title: string; tags: string[]; properties: Record<string, unknown> }>({
		title: initialTitle,
		tags: [],
		properties: {},
	})

	useEffect(() => {
		clipboardMetaRef.current.title = title
	}, [title])

	useEffect(() => {
		let isMounted = true
		const loadMentionables = async () => {
			try {
				const collabs = await fetchMentionablePageCollaborators(pageId)
				if (isMounted) {
					setMentionables(collabs.map(c => ({ id: c.id, name: c.full_name || c.email, email: c.email, avatarUrl: c.avatar_url })))
				}
			} catch (err) {
				console.error('Error fetching mentionables:', err)
			}
		}
		const loadWorkspacePages = async () => {
			try {
				const details = await fetchPageDetails(pageId)
				if (details?.workspace_id && isMounted) {
					setWorkspaceId(details.workspace_id)
					// Mirror Page properties for clipboard copy-out (S3); the
					// synchronous copy handler cannot fetch on demand.
					clipboardMetaRef.current.properties = details.properties || {}
					const pages = await fetchWorkspacePages(details.workspace_id)
					if (isMounted) {
						const summaries: WorkspacePageSummary[] = pages.map(p => ({ id: p.id, title: p.title }))
						setWorkspacePages(summaries)
					}
				}
			} catch (err) {
				console.error('Error fetching workspace pages for wikilinks:', err)
			}
		}
		// Tags load independently and best-effort: a missing/failed tag fetch must
		// never block workspace setup (wikilinks) or clipboard metadata.
		const loadClipboardTags = async () => {
			try {
				const pageTags = await fetchPageTags(pageId)
				if (isMounted) clipboardMetaRef.current.tags = pageTags.map(t => t.tag)
			} catch (err) {
				console.error('Error fetching page tags for clipboard:', err)
			}
		}
		if (pageId && !anonVisitor) {
			loadMentionables()
			loadWorkspacePages()
			loadClipboardTags()
		}
		return () => {
			isMounted = false
		}
	}, [pageId, anonVisitor])

	const inFlightPageCreationsRef = useRef<Set<string>>(new Set())

	const handleNavigateToPage = useCallback((targetPageId: string) => {
		router.push(`/page/${targetPageId}`)
	}, [router])

	const handleCreateWikilinkPage = useCallback(async (targetTitle: string) => {
		if (!workspaceId) {
			// Anonymous visitors have no workspace to create pages in; the
			// loadWorkspacePages fetch is skipped for them entirely. Say so
			// instead of silently no-oping (clean-room finding 4).
			toast.error('Sign in to create pages')
			return
		}
		const normalized = normalizeWikilinkTarget(targetTitle)
		if (inFlightPageCreationsRef.current.has(normalized)) return
		inFlightPageCreationsRef.current.add(normalized)
		try {
			const newPage = await createPage(workspaceId, currentUser.id, null, { title: targetTitle })
			toast.success(`Created page "${targetTitle}"`)
			router.push(`/page/${newPage.id}`)
		} catch (err) {
			console.error('Error creating page from wikilink:', err)
			toast.error(`Failed to create page "${targetTitle}"`)
		} finally {
			inFlightPageCreationsRef.current.delete(normalized)
		}
	}, [workspaceId, currentUser.id, router])

	const handleNavigateToPageRef = useRef(handleNavigateToPage)
	handleNavigateToPageRef.current = handleNavigateToPage

	const handleCreateWikilinkPageRef = useRef(handleCreateWikilinkPage)
	handleCreateWikilinkPageRef.current = handleCreateWikilinkPage

	const handleExport = async (type: ExportType) => {
		if (!editor) {
			setIsExportOpen(false)
			return
		}
		setIsExporting(true)
		track('export_triggered', { format: type })
		try {
			if (type === 'markdown') {
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
				downloadBlob(new Blob([file], { type: 'text/markdown;charset=utf-8' }), exportFilename(title, 'md'))
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

	// Explicit copy-out (SIL-59): copy the whole Page as an Obsidian-safe
	// markdown payload, or as the Notion-facing rich (dual-MIME) payload. Used
	// by the Export menu's "Copy for …" items, outside any copy event.
	const handleCopyFor = async (target: ClipboardTarget) => {
		if (!editor) {
			setIsExportOpen(false)
			return
		}
		setIsExporting(true)
		try {
			const payload = buildClipboardPayload(editor.getJSON(), clipboardMetaRef.current, {
				wholePage: true,
				target,
			})
			const ok = await copyClipboardPayloadToSystem(payload)
			if (!ok) {
				toast.error('Could not access the clipboard')
				return
			}
			track('copy_out_resolved', { whole_page: true, target })
			toast.success(target === 'obsidian' ? 'Copied as Obsidian markdown' : 'Copied for Notion')
		} catch (err) {
			console.warn('Copy-out failed:', err)
			toast.error('Copy failed')
		} finally {
			setIsExporting(false)
			setIsExportOpen(false)
		}
	}

	const handleOpenLekhanBot = useCallback(() => {
		setDiffPreview(null)
		setIsLekhanBotOpen(true)
	}, [])

	// Stable identity so the memoized toolbar is not invalidated by unrelated
	// workspace re-renders (SIL-230 / #144).
	const handleOpenLinkPrompt = useCallback(() => setIsLinkPromptOpen(true), [])

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

	const engineRef = useRef<VersionHistoryEngine | null>(null)
	
	useEffect(() => {
		const adapter = new IndexedDBHistoryAdapter()
		engineRef.current = new VersionHistoryEngine(adapter)
	}, [])

	useEffect(() => {
		if (!engineRef.current || !ydoc || !workspaceId || isViewer) return

		const CHECKPOINT_INTERVAL = 15 * 60 * 1000 // 15 mins
		const DEFAULT_MAX_STORAGE_BYTES = 100 * 1024 * 1024 // 100MB local history cap

		const timer = setInterval(() => {
			if (hasUnsyncedChanges) {
				engineRef.current?.createAutoCheckpoint({
					pageId,
					workspaceId,
					authorName: currentUser.full_name || currentUser.email || 'Unknown User',
					authorId: currentUser.id,
					ydoc,
					maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES
				}).catch(console.error)
			}
		}, CHECKPOINT_INTERVAL)

		return () => clearInterval(timer)
	}, [hasUnsyncedChanges, pageId, workspaceId, currentUser, ydoc, isViewer])

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
			...getSharedExtensions().map((ext) => {
				if (ext.name === 'callout') return LiveCallout
				if (ext.name === 'wikilink') {
					return Wikilink.configure({
						workspacePages,
						onNavigateToPage: (targetPageId) => handleNavigateToPageRef.current(targetPageId),
						onCreatePage: (targetTitle) => handleCreateWikilinkPageRef.current(targetTitle),
						// `[[` autocomplete popup (SIL-159 / #142): Obsidian-style
						// mid-block page suggest + "Create page" empty state.
						// allowedPrefixes null = `[[` fires after any character
						// (Obsidian parity); pages come from the live ref.
						// allowSpaces true keeps the popup alive across spaces so
						// a multi-word title can be typed end-to-end (CodeRabbit
						// #187 Major); the closed-]] grammar guard composed in
						// lib/wikilink's default shouldShow still applies.
						suggestion: {
							char: '[[',
							allowedPrefixes: null,
							allowSpaces: true,
							items: ({ query }: { query: string }) =>
								buildWikilinkSuggestions(workspacePagesRef.current, query),
							command: ({ editor: ed, range, props }: any) => {
								// Guard against committing over a range that already
								// contains a closed link ("[[alias|target]]" edits) —
								// replacing it would orphan the tail as literal text
								// (clean-room finding 2).
								const rangeText = ed.state.doc.textBetween(range.from, range.to, '\n')
								if (typeof rangeText !== 'string' || rangeText.includes(']]')) return
								// Commit a complete `[[target]]` link in place;
								// the decoration plugin re-resolves on this
								// transaction, so an existing page lights up
								// immediately without any extra redraw.
								ed.chain().focus()
									.insertContentAt(range, { type: 'text', text: `[[${props.title}]]` })
									.run()
								// Close the popup on commit (Obsidian parity): the
								// suggestion state machine would otherwise re-match
								// the just-inserted `[[...]]` text and re-open.
								exitWikilinkSuggestion(ed)
								if (props.kind === 'create') {
									handleCreateWikilinkPageRef.current(props.title)
								}
							},
							render: () => {
								let component: any
								let popup: any

								return {
									onStart: (props: any) => {
										const container = document.createElement('div')
										const root = createRoot(container)
										component = { root, container, ref: { current: null } }

										const renderList = (items: any[], command: any) => {
											root.render(
												<WikilinkList
													ref={(r: any) => { component.ref.current = r }}
													items={items}
													command={command}
												/>
											)
										}

										renderList(props.items, props.command)

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
										const renderList = (items: any[], command: any) => {
											component.root.render(
												<WikilinkList
													ref={(r: any) => { component.ref.current = r }}
													items={items}
													command={command}
												/>
											)
										}
										renderList(props.items, props.command)
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
					})
				}
				return ext
			}),
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
			InboxTriage.configure({
				onLink: row => inboxCallbacksRef.current.onLink(row),
				onTag: row => inboxCallbacksRef.current.onTag(row),
			}),
		],

		editorProps: {
			attributes: {
				class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-[500px] text-on-surface break-words w-full',
			},
			handleDOMEvents: {
				// Copy-out (SIL-9 S3): the default ⌘C writes the Obsidian-flavored
				// markdown as `text/plain` ONLY. A dual payload is unsafe here —
				// Obsidian prefers `text/html` when present and runs HTML→markdown,
				// dropping frontmatter and degrading callouts (QA dogfood, SIL-68).
				// Notion users use the explicit "Copy for Notion" action. On any
				// failure we fall back to the browser's native copy.
				copy: (view, event) => {
					const { state } = view
					const { selection } = state
					if (selection.empty) return false
					try {
						const { from, to } = selection
						const wholePage = from <= 0 && to >= state.doc.content.size
						const doc = (wholePage ? state.doc : state.doc.cut(from, to)).toJSON() as JSONContent
						const payload = buildClipboardPayload(doc, clipboardMetaRef.current, { wholePage, target: 'obsidian' })
						if (!writeClipboardPayload(event, payload)) return false
						track('copy_out_resolved', { whole_page: wholePage, target: 'obsidian' })
						event.preventDefault()
						return true
					} catch (err) {
						console.warn('Clipboard copy-out failed; falling back to native copy:', err)
						return false
					}
				},
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

				const kind = classifyClipboardPaste(plainText, htmlText)
				const parser = (currentEditor as any).storage?.markdown?.parser
				const replaceDocument = currentEditor.isEmpty || currentEditor.getText().trim() === ''

				if (kind === 'obsidian-markdown' && parser) {
					// Strip leading frontmatter before parsing the body, and land
					// the extracted keys as Page properties (Obsidian dialect).
					const { properties, body } = splitObsidianFrontmatter(plainText)
					const parsedHtml = body ? parser.parse(body) : ''
					const hasProperties = Object.keys(properties).length > 0
					// A frontmatter-only note has no body HTML; it must still apply
					// its properties and must not fall through to the native paste,
					// which would leave the raw YAML in the document.
					if (parsedHtml || hasProperties) {
						event.preventDefault()
						track('paste_in_resolved', { kind: 'obsidian-markdown' })
						// Snapshot the paste target so a deferred apply can tell
						// whether the document moved on while the properties RPC
						// was in flight.
						const pasteSelection = {
							from: currentEditor.state.selection.from,
							to: currentEditor.state.selection.to,
						}
						const docAtPaste = currentEditor.state.doc
						const pastePageId = pageId
						const applyBody = () => {
							if (!parsedHtml) return
							// A page change must not redirect the deferred body into
							// another document.
							if (pageIdRef.current !== pastePageId) return
							// Prefer the live editor: useEditor may have recreated it
							// while the RPC was pending. Never drop the body just
							// because the paste captured the previous instance.
							const liveEditor = editorRef.current ?? currentEditor
							if (!liveEditor || liveEditor.isDestroyed) return
							if (liveEditor.state.doc.eq(docAtPaste)) {
								// Document untouched: insert at the original paste
								// target with the original replace decision.
								liveEditor.commands.setTextSelection(pasteSelection)
								insertParsedHtml(liveEditor, parsedHtml, { replaceDocument })
							} else {
								// Edits landed while the RPC was pending. Never
								// replace the document the user has been typing in;
								// insert at the live selection instead.
								insertParsedHtml(liveEditor, parsedHtml, { replaceDocument: false })
							}
						}
						if (hasProperties) {
							// Persist the properties BEFORE inserting the body: the
							// insert triggers the debounced save/graph re-index,
							// which derives tag rows from `pages.properties`. The
							// apply above re-validates the document so edits typed
							// during the RPC are never clobbered.
							updatePageProperties(pageId, properties)
								.then(() => {
									// Keep the copy-out metadata ref in step with what
									// the paste just merged, so an immediate ⌘C emits
									// the new properties/tags rather than the pre-paste
									// values. The optimistic merge is authoritative here:
									// the server derives tag rows from properties only
									// after the debounced save, so refetching now would
									// overwrite the correct tags with stale rows.
									clipboardMetaRef.current.properties = {
										...clipboardMetaRef.current.properties,
										...properties,
									}
									const mergedTags = clipboardMetaRef.current.properties.tags
									if (Array.isArray(mergedTags)) {
										clipboardMetaRef.current.tags = mergedTags.filter(
											(t): t is string => typeof t === 'string',
										)
									}
									applyBody()
								})
								.catch((err) => {
									console.error('Error applying pasted Page properties:', err)
									applyBody()
								})
						} else {
							applyBody()
						}
						return true
					}
				}

				if (kind === 'notion-html' && parser && htmlText) {
					// Convert Notion HTML to markdown so mentions become Page
					// links. Fall back to the native HTML paste when conversion
					// yields nothing rather than dropping content.
					const markdown = notionHtmlToMarkdown(htmlText)
					if (markdown) {
						const parsedHtml = parser.parse(markdown)
						if (parsedHtml) {
							event.preventDefault()
							track('paste_in_resolved', { kind: 'notion-html' })
							insertParsedHtml(currentEditor, parsedHtml, { replaceDocument })
							return true
						}
					}
					return false
				}

				if (kind === 'markdown' && parser) {
					const parsedHtml = parser.parse(plainText)
					if (parsedHtml) {
						event.preventDefault()
						track('paste_in_resolved', { kind: 'markdown' })
						// parsedHtml is already HTML — see lib/insert-parsed-html.ts:
						// the markdown command overrides would re-parse it as markdown.
						insertParsedHtml(currentEditor, parsedHtml, { replaceDocument })
						return true
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

	// The page the editor currently shows. A deferred Obsidian paste captures
	// this at paste time so it can never be redirected into a different document
	// if the component switches pages while the properties RPC is in flight.
	const pageIdRef = useRef(pageId)

	// Sync after commit, like editorRef below: mutating a ref during render is
	// unsound under concurrent renders (an interrupted render for a new pageId
	// could poison the guard before commit).
	useLayoutEffect(() => {
		pageIdRef.current = pageId
	}, [pageId])

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

	useEffect(() => {
		if (editor && workspacePages.length > 0) {
			editor.commands.setWorkspacePages(workspacePages)
		}
	}, [editor, workspacePages])

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

	// Inbox triage (DN-T3). `o` appends a back-reference to the chosen page's
	// Related-actions section over that page's CRDT channel, then marks the
	// daily row processed by dropping `#inbox`. `t` keeps the row pending.
	const handleInboxLink = useCallback(async (target: SearchResult) => {
		if (!editor || !inboxTriage || inboxBusyRef.current) return

		inboxBusyRef.current = true
		setInboxBusy(true)
		try {
			await linkInboxRow({
				view: editor.view,
				row: inboxTriage.row,
				target,
				dailyPageTitle: title,
				token,
				ensureCanEdit: async (pageId) => {
					// The picker surfaces shared read-only pages; the sync hub
					// drops viewer writes without an error, so refuse first.
					const targetPage = await fetchPageDetails(pageId)
					if (targetPage.owner_id === currentUser.id) return true
					const role = await fetchPageMemberRole(pageId, currentUser.id)
					return role === 'owner' || role === 'editor'
				},
			})

			toast.success(`Linked to ${target.title}`)
			setInboxTriage(null)
			window.dispatchEvent(new CustomEvent('lekhan:inbox-changed'))
		} catch (error) {
			if (error instanceof InboxTriageError) {
				if (error.code === 'forbidden') {
					toast.error('You do not have edit access to that page.')
				} else if (error.code === 'stale') {
					toast.error('That capture moved. Focus it again and retry.')
					setInboxTriage(null)
				} else {
					toast.error('Could not link that capture.')
				}
			} else {
				console.error('Failed to link inbox capture:', error)
				toast.error('Could not link that capture. Check your connection and try again.')
			}
		} finally {
			inboxBusyRef.current = false
			setInboxBusy(false)
		}
	}, [currentUser.id, editor, inboxTriage, title, token])

	const handleInboxTag = useCallback((tag: string) => {
		if (!editor || !inboxTriage) return

		try {
			const { changed } = tagInboxRow({
				view: editor.view,
				row: inboxTriage.row,
				tag,
			})
			const label = tag.trim().replace(/^#+/, '').toLowerCase()
			toast.success(changed ? `Tagged #${label}` : `Already tagged #${label}`)
			setInboxTriage(null)
			window.dispatchEvent(new CustomEvent('lekhan:inbox-changed'))
		} catch (error) {
			if (error instanceof InboxTriageError && error.code === 'stale') {
				toast.error('That capture moved. Focus it again and retry.')
				setInboxTriage(null)
			} else if (error instanceof InboxTriageError && error.code === 'invalid-tag') {
				toast.error('Use one tag word, for example "launch".')
			} else {
				console.error('Failed to tag inbox capture:', error)
				toast.error('Could not tag that capture. Try again.')
			}
		}
	}, [editor, inboxTriage])

	// Deep link from the dashboard Inbox card: `/page/<id>?section=inbox`
	// scrolls to the Inbox heading once the section actually exists.
	//
	// `isLocalSynced` only covers the IndexedDB copy; the capture connector
	// deliberately does not open y-indexeddb, so a freshly captured page can
	// arrive from the hub later (cold starts can take ~50s). Retry on remote
	// document updates and the hub `isSynced` flip, and stop if the user starts
	// editing before the section lands so we never yank them mid-write.
	useEffect(() => {
		// Wait for the editor to be mounted in the real DOM (the loader replaces it
		// until the viewer check and local sync settle): scrollIntoView on a
		// detached view is a no-op but would consume the single shot.
		if (!editor || isViewer === null || !isLocalSynced) return
		if (inboxScrollDoneRef.current || inboxScrollCancelledRef.current) return
		if (typeof window === 'undefined') return
		const params = new URLSearchParams(window.location.search)
		if (params.get('section') !== 'inbox') return

		let timer: number | undefined = undefined
		let cancelled = false

		const stop = () => {
			cancelled = true
			editor.off('focus', onFocus)
			editor.off('update', tryScroll)
			document.removeEventListener('focusin', onOutsideFocus)
			window.removeEventListener('wheel', onUserScroll)
			window.removeEventListener('touchstart', onUserScroll)
			if (timer !== undefined) window.clearTimeout(timer)
		}

		const cancel = () => {
			// Persist the interruption across effect re-runs; a later hub-sync
			// flag flip must not re-arm the scroll after the user moved on.
			inboxScrollCancelledRef.current = true
			stop()
		}

		const tryScroll = () => {
			if (cancelled || inboxScrollDoneRef.current) return
			if (!editor.view.dom.isConnected) return
			const headings = Array.from(editor.view.dom.querySelectorAll('h1, h2, h3'))
			const inbox = headings.find(heading => heading.textContent?.trim().toLowerCase() === 'inbox')
			if (!inbox) return

			inboxScrollDoneRef.current = true
			stop()
			const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
			inbox.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
		}

		const onFocus = () => cancel()

		const onOutsideFocus = (event: FocusEvent) => {
			const target = event.target as Node | null
			if (!target || !editor.view.dom.contains(target)) cancel()
		}

		const onUserScroll = () => cancel()

		editor.on('focus', onFocus)
		editor.on('update', tryScroll)
		document.addEventListener('focusin', onOutsideFocus)
		window.addEventListener('wheel', onUserScroll, { passive: true })
		window.addEventListener('touchstart', onUserScroll, { passive: true })

		// Bounded fallback for a transport that applies Yjs state without
		// emitting a ProseMirror update; hub sync itself also re-runs this effect.
		timer = window.setTimeout(() => { tryScroll(); stop() }, 60_000)
		tryScroll()

		return () => {
			editor.off('focus', onFocus)
			editor.off('update', tryScroll)
			document.removeEventListener('focusin', onOutsideFocus)
			window.removeEventListener('wheel', onUserScroll)
			window.removeEventListener('touchstart', onUserScroll)
			if (timer !== undefined) window.clearTimeout(timer)
		}
	}, [editor, isViewer, isLocalSynced, isSynced])

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

	// Cmd/Ctrl+L opens the Lekhan Bot bar; Cmd/Ctrl+Shift+S opens version
	// history. Anonymous readers get neither — both features are hidden from
	// the reading surface and history would read from an empty local store.
	useEffect(() => {
		if (anonVisitor || isBacklinksOpen) return
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
				e.preventDefault()
				handleOpenLekhanBot()
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
				e.preventDefault()
				setIsHistoryOpen(true)
			}
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => document.removeEventListener('keydown', handleKeyDown)
	}, [handleOpenLekhanBot, anonVisitor, isBacklinksOpen])

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
						{anonVisitor && (
							<span
								className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold whitespace-nowrap"
								title="This page is shared publicly — anyone with the link can view it"
							>
								<Globe className="w-3.5 h-3.5" />
								<span>Public</span>
								<span className="text-on-surface-variant/80 font-semibold">· view-only</span>
							</span>
						)}
						{!anonVisitor && (
							<div className="hidden md:flex items-center gap-xs ml-2 text-on-surface-variant/60 font-label-sm text-label-sm">
								<SyncIndicator
									connectionState={connectionState}
									isSynced={isSynced}
									hasUnsyncedChanges={hasUnsyncedChanges}
									isLocalSynced={isLocalSynced}
								/>
							</div>
						)}
					</div>

					<div className="flex items-center gap-sm md:gap-md">
						<div className={anonVisitor ? 'hidden' : 'hidden sm:flex -space-x-2 items-center mr-2 md:mr-4'}>
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

						{!anonVisitor && (
							<button
								onClick={openGlobalSearch}
								className="hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium bg-surface-container-low"
								title="Search (Cmd+K)"
							>
								<span className="material-symbols-outlined text-primary-container text-lg">search</span>
							</button>
						)}

						{!anonVisitor && (
							<button
								onClick={() => { setIsBacklinksOpen(!isBacklinksOpen); setIsHistoryOpen(false); setIsAIPanelOpen(false); }}
								aria-pressed={isBacklinksOpen}
								aria-label="Backlinks"
								data-backlink-trigger
								className={`hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium ${isBacklinksOpen ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/30' : 'bg-surface-container-low'}`}
								title="Backlinks"
							>
								<span className="material-symbols-outlined text-primary-container text-lg" aria-hidden="true">link</span>
								<span className="hidden lg:inline">Backlinks</span>
							</button>
						)}

						{!anonVisitor && (
							<button
								onClick={() => { setIsHistoryOpen(!isHistoryOpen); setIsAIPanelOpen(false); setIsBacklinksOpen(false); }}
								className={`hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium ${isHistoryOpen ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/30' : 'bg-surface-container-low'}`}
								title="Version History"
							>
								<span className="material-symbols-outlined text-primary-container text-lg">history</span>
								<span className="hidden lg:inline">History</span>
							</button>
						)}

						{!anonVisitor && (
							<button
								onClick={() => { setIsAIPanelOpen(!isAIPanelOpen); setIsHistoryOpen(false); setIsBacklinksOpen(false); }}
								className={`hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium ${isAIPanelOpen ? 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/30' : 'bg-surface-container-low'}`}
								title="Settings"
							>
								<span className="material-symbols-outlined text-primary-container text-lg">settings</span>
								<span className="hidden lg:inline">Settings</span>
							</button>
						)}

						{!anonVisitor && (
							<MobileHeaderMenu
								isHistoryOpen={isHistoryOpen}
								setIsHistoryOpen={setIsHistoryOpen}
								isAIPanelOpen={isAIPanelOpen}
								setIsAIPanelOpen={setIsAIPanelOpen}
								isBacklinksOpen={isBacklinksOpen}
								setIsBacklinksOpen={setIsBacklinksOpen}
								theme={theme}
								toggleTheme={toggleTheme}
								activeUsers={activeUsers}
								connectionState={connectionState}
								isSynced={isSynced}
								hasUnsyncedChanges={hasUnsyncedChanges}
								isLocalSynced={isLocalSynced}
							/>
						)}

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
										title="Export or copy"
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
												<div role="separator" className="my-0.5 h-px bg-black/10 dark:bg-white/10" />
												{COPY_MENU_ITEMS.map((item) => {
													const Icon = item.icon
													return (
														<button
															key={item.target}
															type="button"
															disabled={isExporting}
															onClick={() => handleCopyFor(item.target)}
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

						<div className={anonVisitor ? 'block' : 'hidden md:block'}>
							<ThemeToggle />
						</div>

						{!anonVisitor && (
							<div>
								<ProfileMenu user={currentUser} size="sm" />
							</div>
						)}
					</div>
				</div>

				{/* Row 2: Formatting Toolbar or Read Only Banner */}
				{!isViewer ? (
					<EditorToolbar
						editor={editor}
						onOpenLinkPrompt={handleOpenLinkPrompt}
						disabled={Boolean(previewDoc)}
					/>
				) : anonVisitor ? (
					<div className="min-h-[40px] py-2 px-6 md:px-10 flex justify-center items-center bg-primary/10 border-y border-primary/20 text-on-surface-variant text-sm font-medium">
						<span className="material-symbols-outlined mr-2 text-base">link</span>
						Anyone with the link can view this page.
					</div>
				) : (
					<div className="min-h-[40px] py-2 px-6 md:px-10 flex justify-center items-center bg-blue-500/10 border-y border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-semibold">
						<span className="material-symbols-outlined mr-2 text-base">visibility</span>
						You have viewing access to this page.
					</div>
				)}

				{/* Row 3: Offline Warning — shown regardless of viewer/toolbar row above */}
				{isOffline && <OfflineBanner />}
			</header>

			<div className="flex-1 flex overflow-hidden relative">
				{/* Main Workspace (Expanded, Dark Continuous Canvas) */}
				<main className={`flex-1 flex flex-col items-center bg-background relative scroll-smooth transition-all overflow-y-auto no-scrollbar py-8 pb-36 ${isBacklinksOpen ? 'lg:mr-[400px]' : (isAIPanelOpen || isHistoryOpen ? 'lg:mr-80' : '')}`}>

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

						{anonVisitor && <PublicPageFooter />}
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


				{isBacklinksOpen && (
					<BacklinkPane
						pageId={pageId}
						pageTitle={title}
						onClose={() => setIsBacklinksOpen(false)}
					/>
				)}

				{engineRef.current && workspaceId && (
					<VersionDrawer
						isOpen={isHistoryOpen}
						onClose={() => setIsHistoryOpen(false)}
						pageId={pageId}
						workspaceId={workspaceId}
						engine={engineRef.current}
						currentYdoc={ydoc}
						currentUser={{
							id: currentUser.id,
							name: currentUser.full_name || currentUser.email || 'Unknown User'
						}}
						isReadOnly={isViewer}
						onRestored={(checkpoint) => {
							toast.success(`Restored version: ${checkpoint.title}`)
							setIsHistoryOpen(false)
						}}
					/>
				)}
			</div>

			<InboxTriageDialog
				mode={inboxTriage?.mode ?? null}
				rowText={inboxTriage?.row.text ?? null}
				busy={inboxBusy}
				onOpenChange={open => { if (!open) setInboxTriage(null) }}
				onSelectPage={target => { void handleInboxLink(target) }}
				onTag={handleInboxTag}
			/>

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

