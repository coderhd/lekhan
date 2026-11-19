'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MemberPageItem, Page, Workspace } from '@/types'
import { supabase } from '@/lib/supabase'
import {
	ensureWorkspace,
	fetchWorkspacePages,
	fetchSharedPages,
	createPage,
	deletePage,
	updatePageTitle,
	fetchPendingPageInvitations
} from '@/services/graph'
import { importMarkdownFile } from '@/services/import'
import Invitations from './invitations'
import ProfileMenu from './profile-menu'
import ThemeToggle from './theme-toggle'
import DailyStrip from './daily-strip'
import InboxCard from './inbox-card'
import { useGlobalSearch } from '@/components/global-search-palette'
import { useQuickCapture } from '@/components/quick-capture-palette'
import GlobalLoader from './global-loader'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
	ArrowRight,
	ChevronRight,
	Folder,
	FileText,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Search
} from 'lucide-react'
import Link from 'next/link'
import WorkbenchShell from './workbench/workbench-shell'
import { InlineEdit } from '@/components/inline-edit'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ImportDialog } from '@/components/import-dialog'
import { VaultExportDialog } from '@/components/vault-export-dialog'
import { track } from '@/lib/analytics'

import { WorkspaceIllustration } from './workbench/workspace-illustration'

interface DashboardProps {
	user: {
		id: string
		email: string
		full_name?: string
	}
}

export default function Dashboard({ user }: DashboardProps) {
	const router = useRouter()
	const { open: openGlobalSearch } = useGlobalSearch()
	const { open: openQuickCapture } = useQuickCapture()
	const [myPages, setMyPages] = useState<Page[]>([])
	const [sharedPages, setSharedPages] = useState<MemberPageItem[]>([])
	const [workspace, setWorkspace] = useState<Workspace | null>(null)
	const [pendingInvitesCount, setPendingInvitesCount] = useState(0)
	const [loading, setLoading] = useState(true)
	const [fetchError, setFetchError] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
	const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
	const [filterDate, setFilterDate] = useState('all')
	const [sortBy, setSortBy] = useState('newest')
	const [pageView, setPageView] = useState<'browse' | 'recent'>('browse')
	const [expandedPages, setExpandedPages] = useState<Set<string>>(() => new Set())

	const fetchRequestIdRef = useRef(0)


	const fetchPages = useCallback(async () => {
		const requestId = ++fetchRequestIdRef.current
		setLoading(true)
		setFetchError(false)
		try {
			const workspace = await ensureWorkspace(user.id)
			const [owned, shared, invites] = await Promise.all([
				fetchWorkspacePages(workspace.id),
				fetchSharedPages(user.id),
				fetchPendingPageInvitations(user.email)
			])
			if (requestId !== fetchRequestIdRef.current) return
			setWorkspace(workspace)
			setMyPages(owned)
			setSharedPages(shared)
			setPendingInvitesCount(invites.length)
		} catch (err) {
			if (requestId !== fetchRequestIdRef.current) return
			console.error('Error fetching pages:', err)
			setFetchError(true)
		} finally {
			if (requestId === fetchRequestIdRef.current) {
				setLoading(false)
			}
		}
	}, [user.id, user.email])

	useEffect(() => {
		fetchPages()
	}, [fetchPages])

	// Refetch pages when a fresh session is established. The inactivity
	// lock re-authenticates via signInWithPassword (same user.id), so the
	// [user.id] effect never re-runs; without this, the dashboard stays blank
	// until a full page reload.
	useEffect(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_IN') {
				fetchPages()
			}
		})
		return () => subscription.unsubscribe()
	}, [fetchPages])

	const handleCreatePage = async () => {
		try {
			const workspace = await ensureWorkspace(user.id)
			const page = await createPage(workspace.id, user.id)
			track('page_created', {
				is_first: myPages.length === 0,
				count: myPages.length + 1
			})
			router.push(`/page/${page.id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to create page: ${message}`)
		}
	}

	const [importDialogOpen, setImportDialogOpen] = useState(false)
	const [vaultExportOpen, setVaultExportOpen] = useState(false)

	const handleImportMarkdown = async (file: File) => {
		if (!file.name.toLowerCase().match(/\.(md|markdown|mdown|txt)$/)) {
			toast.error('Please choose a .md, .markdown, .mdown or .txt file.')
			return
		}
		try {
			const text = await file.text()
			const workspace = await ensureWorkspace(user.id)
			const page = await importMarkdownFile(text, {
				workspaceId: workspace.id,
				ownerId: user.id,
				filename: file.name
			})
			track('import_completed', { source: 'markdown', pages_count: 1 })
			toast.success(`Imported "${page.title}"`)
			router.push(`/page/${page.id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to import: ${message}`)
		}
	}

	const handleDeleteDocument = (id: string) => {
		setDocumentToDelete(id)
	}

	const executeDelete = async () => {
		if (!documentToDelete) return
		try {
			await deletePage(documentToDelete)
			setMyPages(previous => {
				const removed = new Set([documentToDelete])
				const children = new Map<string, string[]>()
				for (const page of previous) {
					if (!page.parent_id) continue
					const siblings = children.get(page.parent_id) ?? []
					siblings.push(page.id)
					children.set(page.parent_id, siblings)
				}
				for (const id of removed) {
					for (const child of children.get(id) ?? []) removed.add(child)
				}
				return previous.filter(page => !removed.has(page.id))
			})
			toast.success('Page deleted successfully')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to delete page: ${message}`)
		} finally {
			setDocumentToDelete(null)
		}
	}

	const handleRenameSubmit = async (id: string, newTitle: string) => {
		try {
			await updatePageTitle(id, newTitle)
			setMyPages((prev) =>
				prev.map((page) =>
					page.id === id ? { ...page, title: newTitle } : page
				)
			)
			setEditingTitleId(null)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to rename page: ${message}`)
		}
	}

	const getDateLimit = useCallback(() => {
		const now = new Date()
		if (filterDate === 'last7days')
			return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		if (filterDate === 'last30days')
			return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		if (filterDate === 'thisYear') return new Date(now.getFullYear(), 0, 1)
		return new Date(0)
	}, [filterDate])

	const applyFiltersAndSort = useCallback(
		(docs: any[], dateField: string, titleField: string) => {
			const dateLimit = getDateLimit()
			return docs
				.filter((doc) => {
					const docDate = new Date(
						doc[dateField] ||
							(doc.documents?.[dateField] ?? doc.pages?.[dateField])
					)
					return docDate >= dateLimit
				})
				.filter((doc) => {
					const title =
						doc[titleField] ||
						(doc.documents?.[titleField] ?? doc.pages?.[titleField]) ||
						''
					return title.toLowerCase().includes(searchQuery.toLowerCase())
				})
				.sort((a, b) => {
					if (sortBy === 'newest') {
						const dateA = new Date(
							a[dateField] || (a.documents?.[dateField] ?? a.pages?.[dateField])
						).getTime()
						const dateB = new Date(
							b[dateField] || (b.documents?.[dateField] ?? b.pages?.[dateField])
						).getTime()
						return dateB - dateA
					}
					if (sortBy === 'oldest') {
						const dateA = new Date(
							a[dateField] || (a.documents?.[dateField] ?? a.pages?.[dateField])
						).getTime()
						const dateB = new Date(
							b[dateField] || (b.documents?.[dateField] ?? b.pages?.[dateField])
						).getTime()
						return dateA - dateB
					}
					if (sortBy === 'alphabetical') {
						const titleA = (
							a[titleField] ||
							(a.documents?.[titleField] ?? a.pages?.[titleField]) ||
							''
						).toLowerCase()
						const titleB = (
							b[titleField] ||
							(b.documents?.[titleField] ?? b.pages?.[titleField]) ||
							''
						).toLowerCase()
						return titleA.localeCompare(titleB)
					}
					return 0
				})
		},
		[getDateLimit, searchQuery, sortBy]
	)

	const filteredMyPages = useMemo(
		() => applyFiltersAndSort(myPages, 'updated_at', 'title') as Page[],
		[applyFiltersAndSort, myPages]
	)
	const filteredSharedPages = useMemo(
		() =>
			applyFiltersAndSort(
				sharedPages,
				'updated_at',
				'title'
			) as MemberPageItem[],
		[applyFiltersAndSort, sharedPages]
	)

	const ownedRows = useMemo(() => {
		const pages = filteredMyPages
		const flat = pages.map(page => ({ page, depth: 0, hasChildren: false }))
		if (pageView === 'recent' || searchQuery.trim() || filterDate !== 'all') return flat

		const ids = new Set(pages.map(page => page.id))
		const children = new Map<string | null, Page[]>()
		for (const page of pages) {
			const parent = page.parent_id && page.parent_id !== page.id && ids.has(page.parent_id) ? page.parent_id : null
			const siblings = children.get(parent) ?? []
			siblings.push(page)
			children.set(parent, siblings)
		}
		const seen = new Set<string>()
		const rows: typeof flat = []
		const visit = (root: Page) => {
			const stack = [{ page: root, depth: 0, visible: true }]
			while (stack.length) {
				const { page, depth, visible } = stack.pop()!
				if (seen.has(page.id)) continue
				seen.add(page.id)
				const nested = children.get(page.id) ?? []
				if (visible) rows.push({ page, depth, hasChildren: nested.length > 0 })
				for (const child of [...nested].reverse()) {
					stack.push({ page: child, depth: depth + 1, visible: visible && expandedPages.has(page.id) })
				}
			}
		}
		for (const root of children.get(null) ?? []) visit(root)
		for (const page of pages) if (!seen.has(page.id)) visit(page)
		return rows
	}, [expandedPages, filterDate, filteredMyPages, pageView, searchQuery])

	const togglePage = (id: string) => {
		setExpandedPages(previous => {
			const next = new Set(previous)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const recentPage = useMemo(
		() =>
			[...myPages].sort(
				(a, b) =>
					new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
			)[0],
		[myPages]
	)

	return (
		<WorkbenchShell
			active="workspace"
			workspaceName={workspace?.name || 'Personal space'}
			pages={myPages.slice(0, 8)}
			onSearch={openGlobalSearch}
			onBrowse={myPages.length ? () => {
				setPageView('browse')
				setSearchQuery('')
				setFilterDate('all')
				document.getElementById('workspace-pages-heading')?.focus()
			} : undefined}
			onCapture={openQuickCapture}
			onImport={() => setImportDialogOpen(true)}
			onExport={() => setVaultExportOpen(true)}
			headerActions={
				<>
					<ThemeToggle />
					<ProfileMenu user={user} size="md" />
				</>
			}
		>
			<div className="wb-page-head">
				<div>
					<h1>Workspace</h1>
					<p>{workspace?.name || 'Your workspace'}</p>
				</div>
				<button
					type="button"
					className="wb-button wb-button-primary"
					onClick={handleCreatePage}
				>
					<Plus aria-hidden="true" />
					New page
				</button>
			</div>
			{loading ? (
				<div role="status">
					<GlobalLoader fullScreen={false} text="Loading dashboard..." />
				</div>
			) : fetchError ? (
				<div className="wb-empty" role="alert">
					<WorkspaceIllustration variant="retry" />
					<h2>Couldn't load your pages</h2>
					<p>
						Retry to reconnect to your workspace.
					</p>
					<button type="button" className="wb-button" onClick={fetchPages}>
						<RefreshCw aria-hidden="true" />
						Try Again
					</button>
				</div>
			) : myPages.length === 0 &&
			  sharedPages.length === 0 &&
			  pendingInvitesCount === 0 ? (
				<div className="wb-empty">
					<WorkspaceIllustration variant="empty" />
					<h2>
						A first page.
						<br />A place to begin.
					</h2>
					<p>
						Start writing, bring an Obsidian vault, or import a Markdown page. A
						workspace grows one thought at a time.
					</p>
					<div className="wb-empty-actions">
						<button
							type="button"
							className="wb-button wb-button-primary"
							onClick={handleCreatePage}
						>
							Create your first page
						</button>
						<button
							type="button"
							className="wb-button"
							onClick={() => setImportDialogOpen(true)}
						>
							Import pages
						</button>
					</div>
					<p>
						Capture without organizing. Send a thought to today’s daily-page
						Inbox, or a page you choose.
					</p>
					<button
						type="button"
						className="wb-button"
						onClick={openQuickCapture}
					>
						Quick capture
					</button>
				</div>
			) : (
				<div className="wb-home">
					<div>
						{recentPage && (
							<section className="wb-continue" aria-label="Continue writing">
								<span className="wb-eyebrow">Continue writing</span>
								<h2>{recentPage.title}</h2>
								{recentPage.searchable_text && (
									<p>{recentPage.searchable_text.slice(0, 240)}</p>
								)}
								<Link className="wb-button" href={`/page/${recentPage.id}`}>
									Open page
									<ArrowRight aria-hidden="true" />
								</Link>
							</section>
						)}
						<div className="wb-section-heading">
							<h2 id="workspace-pages-heading" tabIndex={-1}>{pageView === 'browse' ? 'Workspace pages' : 'Recent pages'}</h2>
							<button
								type="button"
								className="wb-button"
								onClick={openGlobalSearch}
							>
								<Search aria-hidden="true" />
								Search
							</button>
						</div>
						<div className="wb-filter-row">
							<label>
								Filter pages
								<input
									type="search"
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									placeholder="Search titles…"
								/>
							</label>
							<label>
								Updated
								<select
									value={filterDate}
									onChange={(event) => setFilterDate(event.target.value)}
								>
									<option value="all">All time</option>
									<option value="last7days">Last 7 days</option>
									<option value="last30days">Last 30 days</option>
									<option value="thisYear">This year</option>
								</select>
							</label>
							<label>
								Sort
								<select
									value={sortBy}
									onChange={(event) => setSortBy(event.target.value)}
								>
									<option value="newest">Newest first</option>
									<option value="oldest">Oldest first</option>
									<option value="alphabetical">Title A–Z</option>
								</select>
							</label>
						</div>
						<div className="wb-browse-switch" role="group" aria-label="Page view">
							<button type="button" aria-pressed={pageView === 'browse'} onClick={() => setPageView('browse')}>Browse</button>
							<button type="button" aria-pressed={pageView === 'recent'} onClick={() => { setPageView('recent'); setSortBy('newest') }}>Recent</button>
						</div>
						{filteredMyPages.length === 0 ? (
							<p className="wb-eyebrow">
								{myPages.length
									? 'No pages match your current search or filters.'
									: 'You have no pages yet.'}
							</p>
						) : (
							<ul id="browse-pages" aria-label="Owned pages">
								{ownedRows.map(({ page, depth, hasChildren }) => (
									<li className="wb-page-row" key={page.id} style={{ paddingInlineStart: `${Math.min(depth, 8) * 0.75}rem` }}>
										{hasChildren && (
											<button type="button" className="wb-icon-button"
												aria-expanded={expandedPages.has(page.id)}
												aria-label={`Children of ${page.title}`}
												onClick={() => togglePage(page.id)}>
												<ChevronRight className={expandedPages.has(page.id) ? 'rotate-90' : ''} aria-hidden="true" />
											</button>
										)}
										{editingTitleId === page.id ? (
											<InlineEdit
												initialValue={page.title}
												isEditingProp
												onSave={(title) => handleRenameSubmit(page.id, title)}
												onCancelEdit={() => setEditingTitleId(null)}
												containerClassName="min-w-0 flex-1"
											/>
										) : (
											<Link href={`/page/${page.id}`}>
												{hasChildren ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />}
												<span className="wb-page-label">
													{page.title}
													<small>
														Owned ·{' '}
														{new Date(page.updated_at).toLocaleDateString()}
													</small>
												</span>
											</Link>
										)}
										<DropdownMenu.Root modal={false}>
											<DropdownMenu.Trigger asChild>
												<button
													type="button"
													className="wb-icon-button"
													aria-label={`Actions for ${page.title}`}
												>
													<MoreHorizontal aria-hidden="true" />
												</button>
											</DropdownMenu.Trigger>
											<DropdownMenu.Portal>
												<DropdownMenu.Content
													className="z-50 min-w-40 rounded-lg border border-outline-variant bg-surface-container p-2 text-sm shadow-lg"
													align="end"
												>
													<DropdownMenu.Item
														className="cursor-pointer rounded p-3 outline-none focus:bg-surface-container-high"
														onSelect={() => setEditingTitleId(page.id)}
													>
														Rename
													</DropdownMenu.Item>
													<DropdownMenu.Item
														className="cursor-pointer rounded p-3 text-error outline-none focus:bg-surface-container-high"
														onSelect={() => handleDeleteDocument(page.id)}
													>
														Delete
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Portal>
										</DropdownMenu.Root>
									</li>
								))}
							</ul>
						)}
						<div className="wb-capture">
							<div>
								Catch a thought
								<small>
									Ctrl / ⌘ Shift C · today’s Inbox or a page you choose
								</small>
							</div>
							<button
								type="button"
								className="wb-button"
								onClick={openQuickCapture}
							>
								<Plus aria-hidden="true" />
								Capture
							</button>
						</div>
					</div>
					<aside className="wb-context" aria-label="Workspace context">
						<section>
							<h2>Shared pages</h2>
							<p>Work that stays connected to its collaborators.</p>
							{filteredSharedPages.length === 0 ? (
								<p>
									{sharedPages.length
										? 'No shared pages match your filters.'
										: "Pages appear here when you're invited to collaborate."}
								</p>
							) : (
								<ul aria-label="Shared pages">
									{filteredSharedPages.map((item) => (
										<li className="wb-page-row" key={item.pages.id}>
											<Link href={`/page/${item.pages.id}`}>
												<FileText aria-hidden="true" />
												<span className="wb-page-label">
													{item.pages.title}
													<small>
														{item.role === 'editor' ? 'Editor' : 'Viewer'} ·{' '}
														{new Date(
															item.pages.updated_at
														).toLocaleDateString()}
													</small>
												</span>
											</Link>
										</li>
									))}
								</ul>
							)}
						</section>
						<section>
							<h2>
								Invitations
								{pendingInvitesCount > 0 ? ` (${pendingInvitesCount})` : ''}
							</h2>
							{pendingInvitesCount > 0 ? (
								<Invitations
									userEmail={user.email}
									userId={user.id}
									onRefresh={fetchPages}
									variant="default"
								/>
							) : (
								<p>No pending invitations.</p>
							)}
						</section>
						{workspace && (
							<>
								<section aria-label="Daily pages">
									<DailyStrip workspaceId={workspace.id} ownerId={user.id} />
								</section>
								<section aria-label="Daily Inbox">
									<InboxCard workspaceId={workspace.id} ownerId={user.id} />
								</section>
							</>
						)}
					</aside>
				</div>
			)}
			<ImportDialog
				open={importDialogOpen}
				onOpenChange={setImportDialogOpen}
				getWorkspace={async () => await ensureWorkspace(user.id)}
				existingPageTitles={[
					...myPages.map((page) => page.title),
					...sharedPages.map((item) => item.pages.title)
				]}
				onMarkdownFile={handleImportMarkdown}
				onOpenPage={(pageId) => router.push(`/page/${pageId}`)}
				onImportComplete={() => {
					setPageView('browse')
					setSearchQuery('')
					setFilterDate('all')
					return fetchPages()
				}}
			/>
			<VaultExportDialog
				open={vaultExportOpen}
				onOpenChange={setVaultExportOpen}
				pages={myPages}
			/>
			<ConfirmDialog
				open={!!documentToDelete}
				onOpenChange={(open) => !open && setDocumentToDelete(null)}
				title="Delete Page"
				description="Delete this page and any pages nested inside it? This action cannot be undone."
				onConfirm={executeDelete}
				confirmText="Delete"
			/>
		</WorkbenchShell>
	)
}
