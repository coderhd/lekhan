import React, { useEffect, useState, useMemo } from 'react'
import * as Y from 'yjs'
import { X, Pin } from 'lucide-react'
import { VersionHistoryEngine } from '../../lib/version-history/engine'
import { DocumentCheckpoint } from '../../lib/version-history/types'
import { VisualDiffViewer } from './visual-diff-viewer'
import { RestoreConfirmDialog } from './restore-confirm-dialog'
import { getPlanLimits } from '@/lib/tier-limits'
import { toast } from 'sonner'

export interface VersionDrawerProps {
	isOpen: boolean
	onClose: () => void
	pageId: string
	workspaceId: string
	engine: VersionHistoryEngine
	currentYdoc: Y.Doc
	currentUser: { id: string; name: string }
	onRestored?: (checkpoint: DocumentCheckpoint) => void
	userPlan?: 'free' | 'plus' | 'pro'
	isReadOnly?: boolean
}

export function VersionDrawer({
	isOpen,
	onClose,
	pageId,
	workspaceId,
	engine,
	currentYdoc,
	currentUser,
	onRestored,
	userPlan = 'free',
	isReadOnly = false
}: VersionDrawerProps) {
	const [versions, setVersions] = useState<DocumentCheckpoint[]>([])
	const [filter, setFilter] = useState<'all' | 'milestones'>('all')
	const [selectedVersion, setSelectedVersion] = useState<DocumentCheckpoint | null>(null)
	const [snapshotText, setSnapshotText] = useState<string>('')
	const [currentText, setCurrentText] = useState<string>('')
	const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
	const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false)
	const [isRestoring, setIsRestoring] = useState(false)

	const loadVersions = async () => {
		const list = await engine.listVersions(pageId)
		list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
		setVersions(list)
	}

	useEffect(() => {
		if (isOpen) {
			loadVersions()
			
			// Compute current text
			try {
				const type = currentYdoc.get('default')
				if (type instanceof Y.Text) {
					setCurrentText(type.toString())
				} else if (type instanceof Y.XmlFragment) {
					let text = ''
					for (let i = 0; i < type.length; i++) {
						const el = type.get(i)
						if (el instanceof Y.XmlElement || el instanceof Y.XmlText) {
							text += el.toString()
						}
					}
					setCurrentText(text)
				}
			} catch (e) {
				console.error(e)
			}
		}
	}, [isOpen, pageId])

	useEffect(() => {
		let isMounted = true
		if (selectedVersion) {
			engine.getSnapshotText(selectedVersion)
				.then((text) => {
					if (isMounted) {
						setSnapshotText(text)
					}
				})
				.catch((err) => {
					if (isMounted) {
						console.error(err)
						setSnapshotText('')
					}
				})
		} else {
			setSnapshotText('')
		}
		return () => {
			isMounted = false
		}
	}, [selectedVersion, engine])

	const handleCreateMilestone = async () => {
		if (!newMilestoneTitle.trim() || isReadOnly) return
		try {
			await engine.createMilestone({
				pageId,
				workspaceId,
				title: newMilestoneTitle.trim(),
				authorName: currentUser.name,
				authorId: currentUser.id,
				ydoc: currentYdoc
			})
			setNewMilestoneTitle('')
			loadVersions()
			toast.success(`Created milestone "${newMilestoneTitle.trim()}"`)
		} catch (err) {
			console.error('Failed to create milestone:', err)
			toast.error('Failed to create milestone checkpoint')
		}
	}

	const handleRestore = async () => {
		if (!selectedVersion || isRestoring || isReadOnly) return
		setIsRestoring(true)
		try {
			const checkpoint = await engine.restoreCheckpoint({
				pageId,
				workspaceId,
				checkpointId: selectedVersion.id,
				targetYdoc: currentYdoc,
				authorName: currentUser.name,
				authorId: currentUser.id
			})
			if (onRestored) {
				onRestored(checkpoint)
			}
			await loadVersions()
			setIsRestoreDialogOpen(false)
			setSelectedVersion(null)
			toast.success(`Restored checkpoint "${selectedVersion.title}"`)
		} catch (err) {
			console.error('Failed to restore checkpoint:', err)
			toast.error('Failed to restore version checkpoint')
		} finally {
			setIsRestoring(false)
		}
	}

	const filteredVersions = useMemo(() => {
		return versions.filter(v => filter === 'all' || v.isPinned)
	}, [versions, filter])

	const retentionMap: Record<string, string> = {
		free: `${getPlanLimits('free').historyRetentionDays} day`,
		plus: `${getPlanLimits('plus').historyRetentionDays} days`,
		pro: `${getPlanLimits('pro').historyRetentionDays} days`
	}

	if (!isOpen) return null

	return (
		<div className="fixed inset-y-0 right-0 z-50 w-full md:w-[600px] bg-background border-l shadow-2xl flex flex-col">
			<div className="flex items-center justify-between p-4 border-b">
				<h2 className="text-lg font-semibold">Version History</h2>
				<button onClick={onClose} className="p-2 hover:bg-accent rounded-full">
					<X className="w-5 h-5" />
				</button>
			</div>
			
			<div className="p-4 bg-muted/50 text-xs text-muted-foreground">
				Local: Unlimited &middot; Cloud: {retentionMap[userPlan] || retentionMap.free}
			</div>

			<div className="p-4 border-b">
				<div className="flex space-x-2 mb-4">
					<button
						className={`px-3 py-1 rounded-full text-sm ${filter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'}`}
						onClick={() => setFilter('all')}
						role="tab"
					>
						All
					</button>
					<button
						className={`px-3 py-1 rounded-full text-sm ${filter === 'milestones' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'}`}
						onClick={() => setFilter('milestones')}
						role="tab"
					>
						Milestones
					</button>
				</div>
				
				{!isReadOnly && (
					<div className="flex space-x-2">
						<input
							type="text"
							value={newMilestoneTitle}
							onChange={(e) => setNewMilestoneTitle(e.target.value)}
							placeholder="Milestone name..."
							className="flex-1 px-3 py-1 text-sm border rounded"
						/>
						<button
							onClick={handleCreateMilestone}
							disabled={!newMilestoneTitle.trim()}
							className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
						>
							New Milestone
						</button>
					</div>
				)}
			</div>

			<div className="flex-1 overflow-hidden flex flex-col md:flex-row">
				<div className="w-full md:w-1/2 border-r overflow-y-auto p-4 space-y-4">
					{filteredVersions.map(v => (
						<button
							type="button"
							key={v.id}
							className={`w-full text-left p-3 border rounded transition-colors ${selectedVersion?.id === v.id ? 'border-primary ring-1 ring-primary bg-primary/5' : 'hover:border-primary/50'}`}
							onClick={() => setSelectedVersion(v)}
						>
							<div className="flex justify-between items-start mb-1">
								<h4 className="font-medium text-sm flex items-center space-x-1">
									{v.isPinned && <Pin className="w-3 h-3 text-primary" />}
									<span>{v.title}</span>
								</h4>
								<span className="text-xs text-muted-foreground">
									{new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								</span>
							</div>
							<div className="text-xs text-muted-foreground flex justify-between">
								<span>{v.authorName}</span>
								<span>{new Date(v.createdAt).toLocaleDateString()}</span>
							</div>
						</button>
					))}
					{filteredVersions.length === 0 && (
						<div className="text-center text-sm text-muted-foreground py-8">
							No versions found
						</div>
					)}
				</div>
				
				<div className="w-full md:w-1/2 flex flex-col bg-muted/10">
					{selectedVersion ? (
						<>
							<div className="p-4 border-b bg-background flex justify-between items-center">
								<h3 className="font-semibold text-sm truncate pr-2">{selectedVersion.title}</h3>
								{!isReadOnly && (
									<button
										onClick={() => setIsRestoreDialogOpen(true)}
										className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded"
									>
										Restore
									</button>
								)}
							</div>
							<div className="flex-1 overflow-y-auto p-4 text-sm font-mono bg-background">
								<VisualDiffViewer previousText={snapshotText} currentText={currentText} />
							</div>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
							Select a version to preview
						</div>
					)}
				</div>
			</div>

			<RestoreConfirmDialog
				isOpen={isRestoreDialogOpen}
				onCancel={() => setIsRestoreDialogOpen(false)}
				onConfirm={handleRestore}
				isLoading={isRestoring}
			/>
		</div>
	)
}
