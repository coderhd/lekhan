'use client'

import { useState, useEffect } from 'react'
import * as Y from 'yjs'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentVersion } from '@/types'
import { fetchVersions } from '@/services/db'
import { History, Save, ArrowLeft, RefreshCw } from 'lucide-react'

interface VersionHistoryProps {
	isOpen: boolean
	onClose: () => void
	documentId: string
	ydoc: Y.Doc
	token: string
	isViewer: boolean
	onPreviewVersion: (tempDoc: Y.Doc | null, versionName?: string) => void
	onRestoreVersion: (tempDoc: Y.Doc) => void
}

export default function VersionHistory({
	isOpen,
	onClose,
	documentId,
	ydoc,
	token,
	isViewer,
	onPreviewVersion,
	onRestoreVersion,
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
		}
	}, [isOpen, documentId])

	const handleSaveVersion = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!newVersionName.trim() || saving) {
			return
		}
		setSaving(true)

		try {
			// 1. Encode ydoc to base64
			const stateUpdate = Y.encodeStateAsUpdate(ydoc)
			const base64State = Buffer.from(stateUpdate).toString('base64')

			// 2. Call Next.js API route
			const res = await fetch('/api/version', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					documentId,
					versionName: newVersionName,
					base64State,
				}),
			})

			if (!res.ok) {
				const errData = await res.json()
				throw new Error(errData.error || 'Failed to save version')
			}

			setNewVersionName('')
			toast.success('Version saved successfully!')
			loadVersions()
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to save: ${message}`)
		} finally {
			setSaving(false)
		}
	}

	const handleSelectVersion = async (version: DocumentVersion) => {
		if (activePreviewId === version.id) {
			// Toggle off preview
			setActivePreviewId(null)
			onPreviewVersion(null)
			return
		}

		setLoading(true)
		try {
			// Download binary from Supabase Storage
			const { data, error } = await supabase.storage
				.from('documents')
				.download(`${documentId}/versions/${version.id}.bin`)

			if (error || !data) {
				throw error || new Error('No data returned')
			}

			const buffer = await data.arrayBuffer()
			const uint8Array = new Uint8Array(buffer)

			// Load into a temporary ydoc
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
			// 1. Download snapshot state
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

			// 3. Clear preview
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

	return (
		<aside className='absolute right-0 top-0 bottom-0 w-80 bg-surface-container-low border-l border-white/10 p-6 flex flex-col z-[60] shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-200'>
			<div className='flex items-center justify-between border-b border-white/10 pb-4 mb-6'>
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
					className='rounded-lg p-1 hover:bg-white/10 text-on-surface-variant hover:text-on-surface transition'
				>
					<span className="material-symbols-outlined text-lg">close</span>
				</button>
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
						disabled={saving}
						className='w-full rounded-xl bg-primary-container text-on-primary-container font-semibold py-2.5 text-xs hover:brightness-110 active:scale-95 transition-all shadow-sm flex items-center justify-center gap-1.5'
					>
						<span className="material-symbols-outlined text-sm">save</span>
						<span>{saving ? 'Saving...' : 'Save Checkpoint'}</span>
					</button>
				</form>
			)}

			{/* Timeline list */}
			<div className='flex-1 overflow-y-auto space-y-4 pr-1.5 no-scrollbar'>
				{loading ? (
					<div className='text-center text-xs text-on-surface-variant/70 py-4 flex items-center justify-center gap-2'>
						<span className="animate-spin h-3.5 w-3.5 border-2 border-primary-container border-t-transparent rounded-full" />
						<span>Loading...</span>
					</div>
				) : versions.length === 0 ? (
					<div className="flex flex-col items-center justify-center pt-24 pb-10 text-center opacity-0 animate-fade-in-up stagger-2">
						<img src="/undraw_no-data_ig65.svg" alt="No versions" className="w-32 h-32 mb-4 opacity-90 drop-shadow-sm" />
						<p className='text-xs text-on-surface-variant font-medium'>No versions captured yet.</p>
					</div>
				) : (
					versions.map((v) => (
						<div
							key={v.id}
							className={`rounded-xl border p-4 transition text-left cursor-pointer ${activePreviewId === v.id ? 'bg-white/10 border-primary-container/50' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
							onClick={() => handleSelectVersion(v)}
						>
							<div className='flex justify-between items-start gap-2'>
								<h4 className='font-bold text-sm text-on-surface truncate max-w-[150px]'>
									{v.version_name}
								</h4>
								{activePreviewId === v.id && (
									<span className='rounded bg-primary-container/20 border border-primary-container/30 px-1.5 py-0.5 text-[8px] font-bold text-primary-container uppercase tracking-wider'>
										Active
									</span>
								)}
							</div>
							<p className='text-[10px] text-on-surface-variant/70 mt-1'>
								By: {v.profiles?.full_name || v.profiles?.email}
							</p>
							<p className='text-[10px] text-on-surface-variant/50'>
								{new Date(v.created_at).toLocaleString()}
							</p>

							{activePreviewId === v.id && !isViewer && (
								<button
									onClick={(e) => {
										e.stopPropagation()
										handleRestore(v)
									}}
									className='mt-3 w-full rounded-xl bg-primary-container text-on-primary-container font-semibold py-2 text-xs hover:brightness-110 transition-all'
								>
									Restore this version
								</button>
							)}
						</div>
					))
				)}
			</div>
			<ConfirmDialog
				open={!!versionToRestore}
				onOpenChange={(open) => !open && setVersionToRestore(null)}
				title="Restore Version"
				description={`Are you sure you want to restore the document to "${versionToRestore?.version_name}"?`}
				onConfirm={executeRestore}
				confirmText="Restore"
			/>
		</aside>
	)
}
