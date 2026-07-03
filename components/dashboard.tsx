'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { DocumentItem, MemberDocumentItem } from '@/types'
import { fetchOwnedDocuments, fetchSharedDocuments, createDocument } from '@/services/db'
import Invitations from './invitations'

interface DashboardProps {
	user: {
		id: string
		email: string
		full_name?: string
	}
}

export default function Dashboard ({ user }: DashboardProps) {
	const router = useRouter()
	const [myDocs, setMyDocs] = useState<DocumentItem[]>([])
	const [sharedDocs, setSharedDocs] = useState<MemberDocumentItem[]>([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')

	const fetchDocuments = async () => {
		try {
			const [owned, shared] = await Promise.all([
				fetchOwnedDocuments(user.id),
				fetchSharedDocuments(user.id),
			])
			setMyDocs(owned)
			setSharedDocs(shared)
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
		} catch (err: any) {
			alert(`Failed to create document: ${err.message}`)
		}
	}

	const handleSignOut = async () => {
		await supabase.auth.signOut()
		router.push('/login')
	}

	const filteredMyDocs = myDocs.filter(doc =>
		doc.title.toLowerCase().includes(searchQuery.toLowerCase())
	)

	const filteredSharedDocs = sharedDocs.filter(item =>
		item.documents?.title?.toLowerCase().includes(searchQuery.toLowerCase())
	)

	return (
		<div className='min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-950 via-slate-900 to-black text-white p-6 md:p-12'>
			<div className='mx-auto max-w-6xl'>
				{/* Top Header */}
				<header className='mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-6'>
					<div className='flex items-center gap-3'>
						<img src='/logo.png' alt='Lekhan Logo' className='h-12 w-12 rounded-xl shadow-md border border-white/10' />
						<div>
							<h1 className='text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent'>
								Lekhan Workspace
							</h1>
							<p className='text-sm text-slate-400 mt-0.5'>
								Logged in as: <span className='text-slate-300 font-semibold'>{user.email}</span>
							</p>
						</div>
					</div>
					<div className='flex items-center gap-3'>
						<button
							onClick={handleCreateDocument}
							className='rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white shadow-lg transition hover:bg-indigo-500 active:scale-95'
						>
							+ New Document
						</button>
						<button
							onClick={handleSignOut}
							className='rounded-xl bg-slate-800 px-5 py-2.5 font-semibold text-slate-300 border border-slate-700 transition hover:bg-slate-700 active:scale-95'
						>
							Sign Out
						</button>
					</div>
				</header>

				{/* Pending Invitations List */}
				<Invitations
					userEmail={user.email}
					userId={user.id}
					onRefresh={fetchDocuments}
				/>

				{/* Search bar */}
				<div className='mb-8 max-w-md'>
					<input
						type='text'
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder='Search documents...'
						className='w-full rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none backdrop-blur-md'
					/>
				</div>

				{loading ? (
					<div className='flex h-64 items-center justify-center text-slate-400'>
						Loading workspace...
					</div>
				) : (
					<div className='space-y-12'>
						{/* My Documents Section */}
						<section>
							<h2 className='mb-6 text-xl font-bold tracking-wide text-slate-200'>
								My Documents
							</h2>
							{filteredMyDocs.length === 0 ? (
								<p className='text-sm text-slate-500 italic'>No documents found. Create one to get started!</p>
							) : (
								<div className='grid gap-4 sm:grid-cols-2 md:grid-cols-3'>
									{filteredMyDocs.map((doc) => (
										<div
											key={doc.id}
											onClick={() => router.push(`/doc/${doc.id}`)}
											className='group relative cursor-pointer rounded-2xl border border-white/5 bg-slate-900/40 p-6 transition duration-300 hover:border-indigo-500/30 hover:bg-slate-900/80 hover:shadow-indigo-950/20 hover:shadow-xl'
										>
											<h3 className='font-bold text-white group-hover:text-indigo-400 transition truncate'>
												{doc.title}
											</h3>
											<p className='text-xs text-slate-500 mt-2'>
												Created: {new Date(doc.created_at).toLocaleDateString()}
											</p>
											<p className='text-xs text-slate-500'>
												Updated: {new Date(doc.updated_at).toLocaleDateString()}
											</p>
										</div>
									))}
								</div>
							)}
						</section>

						{/* Shared with Me Section */}
						<section>
							<h2 className='mb-6 text-xl font-bold tracking-wide text-slate-200'>
								Shared with Me
							</h2>
							{filteredSharedDocs.length === 0 ? (
								<p className='text-sm text-slate-500 italic'>No documents shared with you yet.</p>
							) : (
								<div className='grid gap-4 sm:grid-cols-2 md:grid-cols-3'>
									{filteredSharedDocs.map((item) => (
										<div
											key={item.documents.id}
											onClick={() => router.push(`/doc/${item.documents.id}`)}
											className='group relative cursor-pointer rounded-2xl border border-white/5 bg-slate-900/40 p-6 transition duration-300 hover:border-indigo-500/30 hover:bg-slate-900/80 hover:shadow-indigo-950/20 hover:shadow-xl'
										>
											<h3 className='font-bold text-white group-hover:text-indigo-400 transition truncate'>
												{item.documents.title}
											</h3>
											<div className='mt-2 flex items-center justify-between'>
												<span className='rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] uppercase font-bold text-slate-400'>
													{item.role}
												</span>
												<span className='text-[10px] text-slate-500'>
													Updated: {new Date(item.documents.updated_at).toLocaleDateString()}
												</span>
											</div>
										</div>
									))}
								</div>
							)}
						</section>
					</div>
				)}
			</div>
		</div>
	)
}
