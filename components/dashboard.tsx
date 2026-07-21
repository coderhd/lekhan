'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentItem, MemberDocumentItem } from '@/types'
import { fetchOwnedDocuments, fetchSharedDocuments, createDocument, deleteDocument, updateDocumentTitle, fetchPendingInvitations } from '@/services/db'
import Invitations from './invitations'
import ProfileMenu from './profile-menu'
import ThemeToggle from './theme-toggle'
import GlobalLoader from './global-loader'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import { InlineEdit } from '@/components/inline-edit'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface DashboardProps {
	user: {
		id: string
		email: string
		full_name?: string
	}
}

import { GlobalHeaderSlot } from './layout/global-header-context'

export default function Dashboard({ user }: DashboardProps) {
	const router = useRouter()
	const [myDocs, setMyDocs] = useState<DocumentItem[]>([])
	const [sharedDocs, setSharedDocs] = useState<MemberDocumentItem[]>([])
	const [pendingInvitesCount, setPendingInvitesCount] = useState(0)
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
	const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
	const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null)
	const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
	const [filterDate, setFilterDate] = useState('all')
	const [sortBy, setSortBy] = useState('newest')

	const myDocsScrollRef = useRef<HTMLDivElement>(null)
	const sharedDocsScrollRef = useRef<HTMLDivElement>(null)
	const [myDocsScrollState, setMyDocsScrollState] = useState({ left: false, right: false })
	const [sharedDocsScrollState, setSharedDocsScrollState] = useState({ left: false, right: false })

	const scrollContainer = (ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') => {
		if (ref.current) {
			const scrollAmount = ref.current.clientWidth * 0.8
			ref.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' })
		}
	}

	const handleScrollCheck = (target: HTMLDivElement, setter: React.Dispatch<React.SetStateAction<{ left: boolean, right: boolean }>>) => {
		const left = target.scrollLeft > 0
		const right = target.scrollLeft < target.scrollWidth - target.clientWidth - 1
		setter({ left, right })
	}



	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' || 'dark'
			if (savedTheme === 'dark') {
				document.documentElement.classList.add('dark')
			} else {
				document.documentElement.classList.remove('dark')
			}
		}
	}, [])

	useEffect(() => {
		const handleGlobalClick = () => {
			if (activeActionMenuId) {
				setActiveActionMenuId(null)
			}
		}
		document.addEventListener('click', handleGlobalClick)
		return () => document.removeEventListener('click', handleGlobalClick)
	}, [activeActionMenuId])

	const notificationsRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
				setIsNotificationsOpen(false)
			}
		}

		if (isNotificationsOpen) {
			document.addEventListener('mousedown', handleClickOutside)
		}
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isNotificationsOpen])

	// Removed infinite scroll listener in favor of Load More buttons

	const fetchDocuments = async () => {
		try {
			const [owned, shared, invites] = await Promise.all([
				fetchOwnedDocuments(user.id),
				fetchSharedDocuments(user.id),
				fetchPendingInvitations(user.email)
			])
			setMyDocs(owned)
			setSharedDocs(shared)
			setPendingInvitesCount(invites.length)
		} catch (err) {
			console.error('Error fetching documents:', err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchDocuments()
	}, [user.id])

	const handleCreateDocument = async () => {
		try {
			const doc = await createDocument(user.id)
			router.push(`/doc/${doc.id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to create document: ${message}`)
		}
	}



	const handleDeleteDocument = (id: string, e: React.MouseEvent) => {
		e.stopPropagation()
		setDocumentToDelete(id)
		setActiveActionMenuId(null)
	}

	const executeDelete = async () => {
		if (!documentToDelete) return
		try {
			await deleteDocument(documentToDelete)
			setMyDocs(prev => prev.filter(doc => doc.id !== documentToDelete))
			toast.success('Document deleted successfully')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to delete document: ${message}`)
		} finally {
			setDocumentToDelete(null)
		}
	}

	const handleRenameSubmit = async (id: string, newTitle: string) => {
		try {
			await updateDocumentTitle(id, newTitle)
			setMyDocs(prev => prev.map(doc => doc.id === id ? { ...doc, title: newTitle } : doc))
			setEditingTitleId(null)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to rename document: ${message}`)
		}
	}

	const handleStartRename = (id: string, e: React.MouseEvent) => {
		e.stopPropagation()
		setEditingTitleId(id)
	}

	const getDateLimit = useCallback(() => {
		const now = new Date()
		if (filterDate === 'last7days') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		if (filterDate === 'last30days') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		if (filterDate === 'thisYear') return new Date(now.getFullYear(), 0, 1)
		return new Date(0)
	}, [filterDate])

	const applyFiltersAndSort = useCallback((docs: any[], dateField: string, titleField: string) => {
		const dateLimit = getDateLimit()
		return docs
			.filter(doc => {
				const docDate = new Date(doc[dateField] || (doc.documents && doc.documents[dateField]))
				return docDate >= dateLimit
			})
			.filter(doc => {
				const title = doc[titleField] || (doc.documents && doc.documents[titleField]) || ''
				return title.toLowerCase().includes(searchQuery.toLowerCase())
			})
			.sort((a, b) => {
				if (sortBy === 'newest') {
					const dateA = new Date(a[dateField] || (a.documents && a.documents[dateField])).getTime()
					const dateB = new Date(b[dateField] || (b.documents && b.documents[dateField])).getTime()
					return dateB - dateA
				}
				if (sortBy === 'oldest') {
					const dateA = new Date(a[dateField] || (a.documents && a.documents[dateField])).getTime()
					const dateB = new Date(b[dateField] || (b.documents && b.documents[dateField])).getTime()
					return dateA - dateB
				}
				if (sortBy === 'alphabetical') {
					const titleA = (a[titleField] || (a.documents && a.documents[titleField]) || '').toLowerCase()
					const titleB = (b[titleField] || (b.documents && b.documents[titleField]) || '').toLowerCase()
					return titleA.localeCompare(titleB)
				}
				return 0
			})
	}, [getDateLimit, searchQuery, sortBy])

	const filteredMyDocs = useMemo(() => applyFiltersAndSort(myDocs, 'updated_at', 'title') as DocumentItem[], [applyFiltersAndSort, myDocs])
	const filteredSharedDocs = useMemo(() => applyFiltersAndSort(sharedDocs, 'updated_at', 'title') as MemberDocumentItem[], [applyFiltersAndSort, sharedDocs])

	useEffect(() => {
		if (myDocsScrollRef.current) handleScrollCheck(myDocsScrollRef.current, setMyDocsScrollState)
	}, [filteredMyDocs])

	useEffect(() => {
		if (sharedDocsScrollRef.current) handleScrollCheck(sharedDocsScrollRef.current, setSharedDocsScrollState)
	}, [filteredSharedDocs])

	return (
		<div className="min-h-screen bg-background text-on-surface">
			<GlobalHeaderSlot slot="right">
					<div className="flex items-center gap-md">
						<ThemeToggle />
						<div className="relative" ref={notificationsRef}>
							<button
								onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
								className="p-2 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 premium-transition text-on-surface-variant hover:text-on-surface relative hover:scale-110 active:scale-90"
							>
								<span className="material-symbols-outlined leading-none">notifications</span>
								{pendingInvitesCount > 0 && (
									<span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-error animate-pulse" />
								)}
							</button>

							{/* Notification Dropdown */}
							{isNotificationsOpen && (
								<>
									<div className="absolute top-full right-0 mt-2 w-80 bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-dropdown-in origin-top-right">
										<div className="px-4 py-3 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5">
											<p className="font-semibold text-on-surface">Notifications</p>
										</div>
										<Invitations userEmail={user.email} userId={user.id} onRefresh={fetchDocuments} variant="dropdown" />
									</div>
								</>
							)}
						</div>

						<ProfileMenu user={user} size="md" />
					</div>
			</GlobalHeaderSlot>
			<GlobalHeaderSlot slot="main">
				<div className="hidden md:flex flex-1 max-w-xl mx-xl">
					<div className="relative w-full group">
						<span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant premium-transition group-focus-within:text-primary-container">search</span>
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2 pl-10 pr-4 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition placeholder:text-on-surface-variant/50"
							placeholder="Search..."
						/>
					</div>
				</div>
			</GlobalHeaderSlot>

			{/* Main Content */}
			<main className="pt-8 pb-xl px-6 md:px-10 flex justify-center">
				<div className="max-w-7xl w-full flex flex-col gap-xl">

					{loading ? (
						<div className="flex justify-center items-center min-h-[calc(100vh-6rem)]">
							<GlobalLoader fullScreen={false} text="Loading dashboard..." />
						</div>
					) : filteredMyDocs.length === 0 && filteredSharedDocs.length === 0 && pendingInvitesCount === 0 ? (
						myDocs.length === 0 && sharedDocs.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-20 text-center opacity-0 animate-fade-in-up stagger-2 min-h-[60vh]">
								<img src="/undraw_team-assignment_lzot.svg" alt="No documents" className="w-80 h-80 md:w-96 md:h-96 mb-8 opacity-90 drop-shadow-sm" />
								<h3 className="text-2xl font-bold text-on-surface mb-2">Welcome to Lekhan!</h3>
								<p className="text-on-surface-variant max-w-md mb-8">
									You haven't created any documents yet. Create your first document to start collaborating with your team!
								</p>
								<button onClick={handleCreateDocument} className="flex items-center gap-sm bg-primary text-on-primary font-bold px-xl py-3 rounded-lg hover:bg-primary/90 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 premium-transition">
									<span className="material-symbols-outlined">add</span>
									Create
								</button>
							</div>
						) : (
							<div className="flex flex-col items-center justify-center py-20 text-center opacity-0 animate-fade-in-up stagger-2 min-h-[60vh]">
								<img src="/undraw_no-data_ig65.svg" alt="No results" className="w-64 h-64 mb-8 opacity-90 drop-shadow-sm -ml-8" />
								<h3 className="text-2xl font-bold text-on-surface mb-2">No results found</h3>
								<p className="text-on-surface-variant max-w-md mb-8">
									No documents match your current search or filter criteria.
								</p>
							</div>
						)
					) : (
						<>
							{/* Mobile Search Bar */}
							<div className="md:hidden w-full -mt-4 mb-2">
								<div className="relative w-full group">
									<span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant premium-transition group-focus-within:text-primary-container">search</span>
									<input
										type="text"
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2 pl-10 pr-4 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition placeholder:text-on-surface-variant/50"
										placeholder="Search..."
									/>
								</div>
							</div>

							{pendingInvitesCount > 0 && myDocs.length === 0 && sharedDocs.length === 0 && (
								<Invitations userEmail={user.email} userId={user.id} onRefresh={fetchDocuments} variant="default" />
							)}
							{/* My Documents */}
							<section>
								<div className="flex items-center justify-between mb-lg border-b border-white/10 pb-4 opacity-0 animate-fade-in-up stagger-1">
									<div className="flex items-center gap-sm">
										<span className="material-symbols-outlined text-primary-container">folder</span>
										<h2 className="font-headline-md text-title-lg md:text-headline-md text-on-surface">Documents</h2>
									</div>
									<div className="flex items-center gap-sm">
										{(myDocs.length > 0 || sharedDocs.length > 0) && (
											<DropdownMenu.Root modal={false}>
												<DropdownMenu.Trigger asChild>
													<button className="flex items-center gap-2 h-10 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface-container-low hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-sm font-medium">
														<span className="material-symbols-outlined text-[18px]">filter_list</span>
														<span className="hidden md:inline">Filter</span>
													</button>
												</DropdownMenu.Trigger>
												<DropdownMenu.Portal>
													<DropdownMenu.Content align="end" className="z-[9999] min-w-[200px] rounded-xl border border-black/10 dark:border-white/10 bg-surface-container p-2 text-on-surface shadow-xl animate-in fade-in-80 zoom-in-95 backdrop-blur-xl">
														<DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
															Date Modified
														</DropdownMenu.Label>
														{[
															{ val: 'all', label: 'Any time' },
															{ val: 'last7days', label: 'Last 7 days' },
															{ val: 'last30days', label: 'Last 30 days' },
															{ val: 'thisYear', label: 'This year' }
														].map(({ val, label }) => (
															<DropdownMenu.Item key={val} onClick={() => setFilterDate(val)} className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-4 text-sm outline-none transition-colors hover:bg-black/10 dark:hover:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
																<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
																	{filterDate === val && <Check className="h-4 w-4 text-primary-container font-bold" />}
																</span>
																{label}
															</DropdownMenu.Item>
														))}

														<DropdownMenu.Separator className="my-1 mx-2 h-px bg-black/10 dark:bg-white/10" />

														<DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
															Sort By
														</DropdownMenu.Label>
														{[
															{ val: 'newest', label: 'Newest' },
															{ val: 'oldest', label: 'Oldest' },
															{ val: 'alphabetical', label: 'Alphabetical' }
														].map(({ val, label }) => (
															<DropdownMenu.Item key={val} onClick={() => setSortBy(val)} className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-4 text-sm outline-none transition-colors hover:bg-black/10 dark:hover:bg-white/10 data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
																<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
																	{sortBy === val && <Check className="h-4 w-4 text-primary-container font-bold" />}
																</span>
																{label}
															</DropdownMenu.Item>
														))}
													</DropdownMenu.Content>
												</DropdownMenu.Portal>
											</DropdownMenu.Root>
										)}
										<button onClick={handleCreateDocument} className="hidden md:flex items-center gap-sm bg-primary text-on-primary font-bold px-lg py-2 rounded-lg hover:bg-primary/90 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 premium-transition ml-2">
											<span className="material-symbols-outlined">add</span>
											New
										</button>
									</div>
								</div>

								{filteredMyDocs.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-12 text-center opacity-0 animate-fade-in-up stagger-2">
										<img src="/undraw_no-data_ig65.svg" alt="No documents" className="w-48 h-48 mb-6 opacity-90 drop-shadow-sm -ml-8" />
										<h3 className="text-lg font-bold text-on-surface mb-2">No owned documents yet</h3>
										<p className="text-sm text-on-surface-variant max-w-md">
											{myDocs.length === 0
												? "You haven't created any documents. Use the New button to start collaborating!"
												: "No documents match your search query."}
										</p>
									</div>
								) : (
									<div className="relative group/carousel">
										{myDocsScrollState.left && (
											<button
												onClick={() => scrollContainer(myDocsScrollRef, 'left')}
												className="absolute left-0 top-1/2 -translate-y-1/2 -ml-5 z-10 w-10 h-10 rounded-full bg-surface shadow-lg border border-black/10 dark:border-white/10 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:scale-110 text-on-surface"
											>
												<span className="material-symbols-outlined">chevron_left</span>
											</button>
										)}
										<div
											ref={myDocsScrollRef}
											onScroll={(e) => handleScrollCheck(e.currentTarget, setMyDocsScrollState)}
											className="flex overflow-x-auto hide-scrollbar gap-gutter pb-lg snap-x"
										>
											{filteredMyDocs.map((doc) => (
												<div
													key={doc.id}
													onClick={() => router.push(`/doc/${doc.id}`)}
													className="min-w-[260px] w-[260px] sm:min-w-[280px] sm:w-[280px] shrink-0 snap-start bg-white dark:bg-surface border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden group/card opacity-0 animate-fade-in-up stagger-2 premium-transition hover:shadow-xl hover:-translate-y-1 cursor-pointer flex flex-col relative"
												>
													{/* Header Block */}
													<div className="relative h-32 w-full bg-gradient-to-br from-primary/10 to-transparent border-b border-black/5 dark:border-white/5 flex flex-col items-center justify-center overflow-hidden">
														<div className="absolute top-0 right-0 -mr-6 -mt-6 w-24 h-24 bg-primary/20 rounded-full blur-2xl"></div>
														<div className="w-12 h-12 bg-white dark:bg-surface-container-high shadow-sm border border-black/5 dark:border-white/5 rounded-xl flex items-center justify-center z-10 text-primary">
															<span className="material-symbols-outlined text-[24px]">description</span>
														</div>
														<span className="absolute top-3 left-3 px-2 py-0.5 bg-white/80 dark:bg-black/40 backdrop-blur-md border border-black/5 dark:border-white/10 text-primary dark:text-primary-container text-[9px] font-bold rounded uppercase tracking-wider shadow-sm z-10">Owned</span>

														{/* Quick Actions */}
														<div className="absolute top-3 right-3 z-20">
															<div className="relative group/actions" onClick={(e) => e.stopPropagation()}>
																<button
																	onClick={(e) => {
																		e.stopPropagation()
																		setActiveActionMenuId(activeActionMenuId === doc.id ? null : doc.id)
																	}}
																	className="w-7 h-7 rounded-full bg-white/80 dark:bg-black/40 backdrop-blur border border-black/5 dark:border-white/10 text-on-surface flex items-center justify-center opacity-0 group-hover/card:opacity-100 hover:bg-white dark:hover:bg-black/60 shadow-sm transition-all"
																>
																	<span className="material-symbols-outlined text-[16px]">more_vert</span>
																</button>
																{activeActionMenuId === doc.id && (
																	<div className="absolute right-0 mt-1 w-32 bg-surface border border-black/10 dark:border-white/10 rounded-lg shadow-xl transition-all z-50 flex flex-col overflow-hidden">
																		<button onClick={(e) => handleStartRename(doc.id, e)} className="px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2">
																			<span className="material-symbols-outlined text-[14px]">edit</span> Rename
																		</button>
																		<button onClick={(e) => {
																			setActiveActionMenuId(null);
																			handleDeleteDocument(doc.id, e);
																		}} className="px-3 py-2 text-left text-xs hover:bg-error/10 text-error flex items-center gap-2">
																			<span className="material-symbols-outlined text-[14px]">delete</span> Delete
																		</button>
																	</div>
																)}
															</div>
														</div>
													</div>

													{/* Card Body */}
													<div className="p-4 flex flex-col flex-1 bg-surface-container-lowest">
														<InlineEdit
															initialValue={doc.title}
															isEditingProp={editingTitleId === doc.id}
															onSave={(newTitle) => handleRenameSubmit(doc.id, newTitle)}
															onCancelEdit={() => setEditingTitleId(null)}
															containerClassName="w-full flex-1 min-w-0 mb-2"
															textClassName="font-title-md font-bold text-on-surface group-hover/card:text-primary premium-transition truncate w-full px-0 py-0 hover:bg-transparent"
															inputClassName="font-title-md font-bold text-on-surface bg-transparent border-b border-primary outline-none px-1 py-0 w-full flex-1 rounded-none focus:ring-0 focus:border-b-2"
															iconClassName="text-[14px]"
														/>
														<div className="flex items-center justify-between mt-auto">
															<p className="text-on-surface-variant font-label-sm flex items-center gap-1">
																<span className="material-symbols-outlined text-[14px]">schedule</span>
																{new Date(doc.updated_at).toLocaleDateString()}
															</p>
														</div>
													</div>
												</div>
											))}
										</div>
										{myDocsScrollState.right && filteredMyDocs.length > 0 && (
											<button
												onClick={() => scrollContainer(myDocsScrollRef, 'right')}
												className="absolute right-0 top-1/2 -translate-y-1/2 -mr-5 z-10 w-10 h-10 rounded-full bg-surface shadow-lg border border-black/10 dark:border-white/10 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:scale-110 text-on-surface"
											>
												<span className="material-symbols-outlined">chevron_right</span>
											</button>
										)}
									</div>
								)}
							</section>

							{/* Shared with Me */}
							<section>
								<div className="flex items-center justify-between mb-lg border-b border-white/10 pb-4 opacity-0 animate-fade-in-up stagger-2">
									<div className="flex items-center gap-sm">
										<span className="material-symbols-outlined text-primary-container">groups</span>
										<h2 className="font-headline-md text-title-lg md:text-headline-md text-on-surface">Shared</h2>
									</div>
								</div>

								{filteredSharedDocs.length === 0 ? (
									<div className="flex flex-col items-center justify-center py-12 opacity-0 animate-fade-in-up stagger-3 text-center">
										<img src="/undraw_no-data_ig65.svg" alt="No shared documents" className="w-48 h-48 mb-6 opacity-90 drop-shadow-sm -ml-8" />
										<h3 className="text-lg font-bold text-on-surface mb-2">No shared documents yet</h3>
										<p className="text-sm text-on-surface-variant max-w-md">
											{sharedDocs.length === 0
												? "Documents appear here when you're invited to collaborate."
												: "No shared documents match your search query."}
										</p>
									</div>
								) : (
									<div className="relative group/carousel">
										{sharedDocsScrollState.left && (
											<button
												onClick={() => scrollContainer(sharedDocsScrollRef, 'left')}
												className="absolute left-0 top-1/2 -translate-y-1/2 -ml-5 z-10 w-10 h-10 rounded-full bg-surface shadow-lg border border-black/10 dark:border-white/10 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:scale-110 text-on-surface"
											>
												<span className="material-symbols-outlined">chevron_left</span>
											</button>
										)}
										<div
											ref={sharedDocsScrollRef}
											onScroll={(e) => handleScrollCheck(e.currentTarget, setSharedDocsScrollState)}
											className="flex overflow-x-auto hide-scrollbar gap-gutter pb-lg snap-x"
										>
											{filteredSharedDocs.map((item) => (
												<div
													key={item.documents.id}
													onClick={() => router.push(`/doc/${item.documents.id}`)}
													className="min-w-[260px] w-[260px] sm:min-w-[280px] sm:w-[280px] shrink-0 snap-start bg-white dark:bg-surface border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden group/card opacity-0 animate-fade-in-up stagger-3 premium-transition hover:shadow-xl hover:-translate-y-1 cursor-pointer flex flex-col relative"
												>
													<div className="relative h-32 w-full bg-gradient-to-br from-tertiary/10 to-transparent border-b border-black/5 dark:border-white/5 flex flex-col items-center justify-center overflow-hidden">
														<div className="absolute top-0 left-0 -ml-6 -mt-6 w-24 h-24 bg-tertiary/20 rounded-full blur-2xl"></div>
														<div className="w-12 h-12 bg-white dark:bg-surface-container-high shadow-sm border border-black/5 dark:border-white/5 rounded-xl flex items-center justify-center z-10 text-tertiary">
															<span className="material-symbols-outlined text-[24px]">description</span>
														</div>
														<span className="absolute top-3 left-3 px-2 py-0.5 bg-white/80 dark:bg-black/40 backdrop-blur-md border border-black/5 dark:border-white/10 text-tertiary dark:text-tertiary-container text-[9px] font-bold rounded uppercase tracking-wider shadow-sm z-10">Shared</span>
													</div>

													<div className="p-4 flex flex-col flex-1 bg-surface-container-lowest">
														<h4 className="font-title-md font-bold text-on-surface group-hover/card:text-tertiary premium-transition truncate mb-2">{item.documents.title}</h4>
														<div className="flex items-center justify-between mt-auto">
															<p className="text-on-surface-variant font-label-sm flex items-center gap-1">
																<span className="material-symbols-outlined text-[14px]">schedule</span>
																{new Date(item.documents.updated_at).toLocaleDateString()}
															</p>
															<span className="text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-wider bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md border border-black/5 dark:border-white/5">{item.role}</span>
														</div>
													</div>
												</div>
											))}
										</div>
										{sharedDocsScrollState.right && filteredSharedDocs.length > 0 && (
											<button
												onClick={() => scrollContainer(sharedDocsScrollRef, 'right')}
												className="absolute right-0 top-1/2 -translate-y-1/2 -mr-5 z-10 w-10 h-10 rounded-full bg-surface shadow-lg border border-black/10 dark:border-white/10 flex items-center justify-center opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:scale-110 text-on-surface"
											>
												<span className="material-symbols-outlined">chevron_right</span>
											</button>
										)}
									</div>
								)}
							</section>
						</>
					)}
				</div>
			</main>

			{/* FAB for mobile */}
			<button onClick={handleCreateDocument} className="md:hidden fixed bottom-8 right-8 z-[100] w-14 h-14 shimmer-btn animate-shimmer text-on-primary-container rounded-full shadow-2xl flex items-center justify-center active:scale-90 premium-transition">
				<span className="material-symbols-outlined text-3xl">add</span>
			</button>

			<ConfirmDialog
				open={!!documentToDelete}
				onOpenChange={(open) => !open && setDocumentToDelete(null)}
				title="Delete Document"
				description="Are you sure you want to delete this document? This action cannot be undone."
				onConfirm={executeDelete}
				confirmText="Delete"
			/>
		</div>
	)
}
