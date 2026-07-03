'use client'

import { useState, useEffect } from 'react'
import * as Y from 'yjs'
import { supabase } from '@/lib/supabase'
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
}

export default function VersionHistory ({
	isOpen,
	onClose,
	documentId,
	ydoc,
	token,
	isViewer,
	onPreviewVersion,
}: VersionHistoryProps) {
	const [versions, setVersions] = useState<DocumentVersion[]>([])
	const [newVersionName, setNewVersionName] = useState('')
	const [loading, setLoading] = useState(true)
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
			alert('Version saved successfully!')
			loadVersions()
		} catch (err: any) {
			alert(`Failed to save: ${err.message}`)
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
		} catch (err: any) {
			alert(`Failed to load version: ${err.message}`)
		} finally {
			setLoading(false)
		}
	}

	const handleRestore = async (version: DocumentVersion) => {
		if (isViewer) {
			alert('Viewers cannot restore versions')
			return
		}

		if (!confirm(`Are you sure you want to restore the document to "${version.version_name}"?`)) {
			return
		}

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

			const targetText = targetDoc.getText('default').toString()

			// 2. Perform delta replacement in live ydoc
			ydoc.transact(() => {
				const currentText = ydoc.getText('default')
				currentText.delete(0, currentText.length)
				currentText.insert(0, targetText)
			})

			// 3. Clear preview
			setActivePreviewId(null)
			onPreviewVersion(null)
			alert('Document restored successfully!')
		} catch (err: any) {
			alert(`Failed to restore: ${err.message}`)
		} finally {
			setLoading(false)
		}
	}

	if (!isOpen) {
		return null
	}

	return (
		<div className='w-80 border-l border-white/5 bg-slate-900/50 p-6 flex flex-col h-full backdrop-blur-md animate-in slide-in-from-right duration-200'>
			<div className='flex items-center justify-between border-b border-white/5 pb-4 mb-6'>
				<h3 className='text-lg font-bold text-white flex items-center gap-2'>
					<History className='h-4 w-4 text-indigo-400' />
					Version History
				</h3>
				<button
					onClick={onClose}
					className='rounded-lg p-1 hover:bg-slate-800 text-slate-400 hover:text-white transition'
				>
					<ArrowLeft className='h-4 w-4' />
				</button>
			</div>

			{/* Save Version Form */}
			{!isViewer && (
				<form onSubmit={handleSaveVersion} className='mb-6 space-y-2'>
					<input
						type='text'
						value={newVersionName}
						onChange={(e) => setNewVersionName(e.target.value)}
						className='w-full rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none'
						placeholder='Checkpoint Name (e.g., Draft v2)'
						required
					/>
					<button
						type='submit'
						disabled={saving}
						className='w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 active:scale-95 disabled:opacity-50'
					>
						<Save className='h-3.5 w-3.5' />
						<span>{saving ? 'Saving...' : 'Save Checkpoint'}</span>
					</button>
				</form>
			)}

			{/* Timeline list */}
			<div className='flex-1 overflow-y-auto space-y-4 pr-1.5'>
				{loading ? (
					<div className='text-center text-xs text-slate-400 py-4 flex items-center justify-center gap-2'>
						<RefreshCw className='h-3.5 w-3.5 animate-spin text-indigo-400' />
						<span>Loading...</span>
					</div>
				) : versions.length === 0 ? (
					<p className='text-center text-xs text-slate-500 italic py-4'>No versions captured yet.</p>
				) : (
					versions.map((v) => (
						<div
							key={v.id}
							className={`rounded-xl border p-4 transition text-left cursor-pointer ${activePreviewId === v.id ? 'bg-indigo-950/20 border-indigo-500/50' : 'bg-slate-950/40 border-white/5 hover:border-slate-700'}`}
							onClick={() => handleSelectVersion(v)}
						>
							<div className='flex justify-between items-start gap-2'>
								<h4 className='font-bold text-sm text-white truncate max-w-[150px]'>
									{v.version_name}
								</h4>
								{activePreviewId === v.id && (
									<span className='rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300 uppercase'>
										Previewing
									</span>
								)}
							</div>
							<p className='text-[10px] text-slate-500 mt-1'>
								By: {v.profiles?.full_name || v.profiles?.email}
							</p>
							<p className='text-[10px] text-slate-500'>
								{new Date(v.created_at).toLocaleString()}
							</p>

							{activePreviewId === v.id && !isViewer && (
								<button
									onClick={(e) => {
										e.stopPropagation()
										handleRestore(v)
									}}
									className='mt-3 w-full rounded bg-indigo-600 py-1.5 text-[10px] font-semibold text-white transition hover:bg-indigo-500'
								>
									Restore this version
								</button>
							)}
						</div>
					))
				)}
			</div>
		</div>
	)
}
