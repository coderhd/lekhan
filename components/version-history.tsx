'use client'

import { useState, useEffect } from 'react'
import * as Y from 'yjs'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentVersion } from '@/types'
import { fetchVersions } from '@/services/db'

import GlobalLoader from '@/components/global-loader'

interface VersionHistoryProps {
	isOpen: boolean
	onClose: () => void
	documentId: string
	ydoc?: Y.Doc
	token?: string
	isViewer?: boolean
	plan?: string
	onPreviewVersion?: (tempDoc: Y.Doc | null, versionName?: string) => void
	onRestoreVersion?: (tempDoc: Y.Doc) => void
}

export default function VersionHistory({
	isOpen,
	onClose,
	documentId,
	ydoc,
	isViewer = false,
	plan = 'free',
	onPreviewVersion = () => { },
	onRestoreVersion = () => { },
}: VersionHistoryProps) {
	const [versions, setVersions] = useState<DocumentVersion[]>([])
	const [newVersionName, setNewVersionName] = useState('')
	const [loading, setLoading] = useState(true)
	const [versionToRestore, setVersionToRestore] = useState<DocumentVersion | null>(null)
	const [saving, setSaving] = useState(false)
	const [activePreviewId, setActivePreviewId] = useState<string | null>(null)

	const loadVersions = async () => {
		try {
			const data = await fetchVersions(documentId)
			setVersions(data)
		} catch (err) {
			console.error('Error fetching versions:', err)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		if (isOpen) {
			loadVersions()
		} else {
			setActivePreviewId(null)
			onPreviewVersion(null)
		}
	}, [isOpen, documentId])

	const handleSaveVersion = async (e: React.FormEvent) => {
		e.preventDefault()
		if (isViewer) {
			toast.error('Viewers cannot create checkpoints')
			return
		}
		if (!newVersionName.trim() || !ydoc) return

		setSaving(true)
		try {
			const versionId = crypto.randomUUID()
			const update = Y.encodeStateAsUpdate(ydoc)
			const blob = new Blob([update.buffer as ArrayBuffer], { type: 'application/octet-stream' })

			const { error: storageError } = await supabase.storage
				.from('documents')
				.upload(`${documentId}/versions/${versionId}.bin`, blob)

			if (storageError) throw storageError

			const { error: dbError } = await supabase
				.from('document_versions')
				.insert({
					id: versionId,
					document_id: documentId,
					version_name: newVersionName.trim(),
					storage_path: `${documentId}/versions/${versionId}.bin`,
				})

			if (dbError) throw dbError

			toast.success('Version checkpoint saved!')
			setNewVersionName('')
			loadVersions()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to save checkpoint: ${message}`)
		} finally {
			setSaving(false)
		}
	}

	const handlePreview = async (version: DocumentVersion) => {
		if (activePreviewId === version.id) {
			setActivePreviewId(null)
			onPreviewVersion(null)
			return
		}

		setLoading(true)
		try {
			const { data, error } = await supabase.storage
				.from('documents')
				.download(`${documentId}/versions/${version.id}.bin`)

			if (error || !data) {
				throw error || new Error('No data returned')
			}

			const buffer = await data.arrayBuffer()
			const uint8Array = new Uint8Array(buffer)

			const tempDoc = new Y.Doc()
			Y.applyUpdate(tempDoc, uint8Array)

			setActivePreviewId(version.id)
			onPreviewVersion(tempDoc, version.version_name)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to load version: ${message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleRestore = (version: DocumentVersion) => {
		if (isViewer) {
			toast.error('Viewers cannot restore versions')
			return
		}
		setVersionToRestore(version)
	}

	const executeRestore = async () => {
		if (!versionToRestore) return
		const version = versionToRestore

		setLoading(true)
		try {
			const { data, error } = await supabase.storage
				.from('documents')
				.download(`${documentId}/versions/${version.id}.bin`)

			if (error || !data) {
				throw error || new Error('No data returned')
			}

			const buffer = await data.arrayBuffer()
			const uint8Array = new Uint8Array(buffer)

			const targetDoc = new Y.Doc()
			Y.applyUpdate(targetDoc, uint8Array)

			onRestoreVersion(targetDoc)

			setActivePreviewId(null)
			onPreviewVersion(null)
			toast.success('Document restored successfully!')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to restore: ${message}`)
		} finally {
			setLoading(false)
			setVersionToRestore(null)
		}
	}

	if (!isOpen) {
		return null
	}

	const getRetentionLabel = (planTier: string) => {
		switch (planTier.toLowerCase()) {
			case 'go': return '14-day cloud & local version history included in Go plan.'
			case 'pro': return '90-day cloud & local version history included in Pro plan.'
			case 'team': return '1-year cloud & local version history included in Team plan.'
			case 'enterprise': return 'Unlimited version history retention active.'
			case 'free':
			default: return '7-day cloud & local version history included in Free plan.'
		}
	}

	return (
		<aside className='absolute right-0 top-0 bottom-0 w-80 bg-background border-l border-white/10 p-6 flex flex-col z-[60] shadow-md backdrop-blur-xl animate-in slide-in-from-right duration-200'>
			<div className='flex items-center justify-between border-b border-white/10 pb-4 mb-4'>
				<div className='flex items-center gap-sm'>
					<div className='w-8 h-8 rounded-lg bg-primary-container/20 flex items-center justify-center'>
						<span className="material-symbols-outlined text-primary-container">history</span>
					</div>
					<div>
						<h3 className="font-title-lg text-title-lg text-on-surface">History</h3>
						<p className="text-[10px] text-primary-container/80 uppercase tracking-widest font-bold">Version Timeline</p>
					</div>
				</div>
				<button
					onClick={onClose}
					className='w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition shrink-0'
					title="Close History"
				>
					<span className="material-symbols-outlined text-lg">close</span>
				</button>
			</div>

			{/* Dynamic Plan Retention Reassurance Note */}
			<div className="mb-4 p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-[11px] text-primary font-medium flex items-center gap-2">
				<span className="shrink-0">🔒</span>
				<span>{getRetentionLabel(plan)}</span>
			</div>

			{/* Save Version Form */}
			{!isViewer && (
				<form onSubmit={handleSaveVersion} className='mb-6 space-y-2'>
					<input
						type='text'
						value={newVersionName}
						onChange={(e) => setNewVersionName(e.target.value)}
						className='w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-2.5 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:ring-2 focus:ring-primary-container/50 focus:border-primary-container outline-none premium-transition'
						placeholder='Checkpoint Name (e.g., Draft v2)'
						required
					/>
					<button
						type='submit'
						disabled={saving || !newVersionName.trim()}
						className='w-full rounded-xl bg-primary-container text-on-primary-container font-semibold py-2.5 text-xs hover:brightness-110 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:pointer-events-none'
					>
						<span className="material-symbols-outlined text-sm">save</span>
						<span>{saving ? 'Saving...' : 'Save Checkpoint'}</span>
					</button>
				</form>
			)}

			{/* Version Timeline */}
			<div className='flex-1 overflow-y-auto space-y-4 pr-1.5 no-scrollbar'>
				{loading ? (
					<div className="py-8">
						<GlobalLoader />
					</div>
				) : versions.length === 0 ? (
					<div className="text-center py-8 text-on-surface-variant text-xs font-medium">
						No checkpoints saved yet.
					</div>
				) : (
					versions.map((ver) => {
						const isPreviewing = activePreviewId === ver.id
						return (
							<div
								key={ver.id}
								className={`p-3.5 rounded-xl border transition-all space-y-2 ${isPreviewing
									? 'bg-primary-container/15 border-primary-container shadow-md'
									: 'bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20'
									}`}
							>
								<div className="flex items-center justify-between">
									<h4 className="text-xs font-bold text-on-surface truncate">{ver.version_name}</h4>
									<span className="text-[10px] text-on-surface-variant/70 shrink-0">
										{new Date(ver.created_at).toLocaleDateString()}
									</span>
								</div>

								<div className="flex items-center gap-2 pt-1">
									<button
										onClick={() => handlePreview(ver)}
										className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium transition ${isPreviewing
											? 'bg-primary-container text-on-primary-container font-bold'
											: 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-on-surface'
											}`}
									>
										{isPreviewing ? 'Previewing' : 'Preview'}
									</button>

									{!isViewer && (
										<button
											onClick={() => handleRestore(ver)}
											className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-on-surface text-[11px] font-medium transition"
										>
											Restore
										</button>
									)}
								</div>
							</div>
						)
					})
				)}
			</div>

			{/* Confirm Restore Dialog */}
			<ConfirmDialog
				open={!!versionToRestore}
				onOpenChange={(open) => { if (!open) setVersionToRestore(null) }}
				title="Restore Version"
				description={`Are you sure you want to restore "${versionToRestore?.version_name}"? Unsaved changes in the current document will be replaced.`}
				confirmText="Restore"
				cancelText="Cancel"
				onConfirm={executeRestore}
			/>
		</aside>
	)
}
