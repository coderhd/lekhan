'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { fetchWorkspaceGraph, fetchWorkspaces, fetchWorkspacePageTags } from '@/services/graph'
import { serializeWorkspaceGraph } from '@/lib/graph-view/serialize'
import type { WorkspaceGraphData } from '@/lib/graph-view/types'
import GraphView from './graph-view'
import WorkspaceViewsNav from './workspace-views-nav'
import GlobalLoader from './global-loader'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'

type Status = 'loading' | 'error' | 'ready' | 'no-workspace'

/**
 * Authed workspace-graph route body.
 *
 * Read-only by construction: it reads the owner's workspace, the workspace
 * graph (`pages` + `page_links`) and `page_tags`. It deliberately does not
 * call `ensureWorkspace`, so visiting the graph can never create rows.
 */
export default function GraphPage () {
	const router = useRouter()
	const [status, setStatus] = useState<Status>('loading')
	const [data, setData] = useState<WorkspaceGraphData | null>(null)
	const requestRef = useRef(0)

	const load = useCallback(async () => {
		const request = requestRef.current + 1
		requestRef.current = request
		const current = () => requestRef.current === request

		setStatus('loading')
		try {
			const { data: { user } } = await supabase.auth.getUser()
			if (!current()) return
			if (!user) {
				router.replace('/login')
				return
			}

			const workspaces = await fetchWorkspaces(user.id)
			if (!current()) return
			const workspace = workspaces[0]
			if (!workspace) {
				setStatus('no-workspace')
				return
			}

			const graph = await fetchWorkspaceGraph(workspace.id)
			const tagsByPage = await fetchWorkspacePageTags(graph.pages.map(page => page.id))
			if (!current()) return

			setData(serializeWorkspaceGraph({ pages: graph.pages, links: graph.links, tagsByPage }))
			setStatus('ready')
		} catch (error) {
			if (!current()) return
			console.error('Failed to load workspace graph:', error)
			setStatus('error')
		}
	}, [router])

	useEffect(() => {
		load()
		return () => {
			// Invalidate in-flight work when the route unmounts.
			requestRef.current += 1
		}
	}, [load])

	return (
		<div className="min-h-screen bg-background text-on-background">
			<main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-8 md:px-10">
				<header className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-3">
						<WorkspaceViewsNav active="graph" />
					</div>
					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="flex flex-col gap-1">
							<h1 className="text-2xl font-bold text-on-surface md:text-3xl">Graph</h1>
							<p className="max-w-2xl text-sm text-on-surface-variant">
								Pages are nodes and page links are edges. Links to pages that don&apos;t exist yet
								show as dashed ghost nodes, so nothing you wrote disappears from the map.
							</p>
						</div>
						{status === 'ready' && data && (
							<p className="text-xs font-medium text-on-surface-variant" aria-live="polite">
								{data.totalPages} pages · {data.edges.length} links
								{data.unresolvedLinks > 0 ? ` · ${data.unresolvedLinks} unresolved` : ''}
							</p>
						)}
					</div>
				</header>

				<section
					aria-label="Workspace graph"
					className="h-[calc(100vh-14rem)] min-h-[420px] w-full"
				>
					{status === 'loading' && (
						<div className="flex h-full items-center justify-center rounded-2xl border border-black/10 dark:border-white/10">
							<GlobalLoader fullScreen={false} text="Building your graph…" />
						</div>
					)}

					{status === 'error' && (
						<div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-black/10 text-center dark:border-white/10">
							<span className="material-symbols-outlined text-[48px] text-error" aria-hidden="true">error</span>
							<h2 className="text-lg font-bold text-on-surface">Couldn&apos;t load your graph</h2>
							<p className="max-w-md text-sm text-on-surface-variant">
								Something went wrong reading your pages and links. Your workspace is unchanged.
							</p>
							<button
								type="button"
								onClick={load}
								className={`flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-bold text-on-primary premium-transition hover:bg-primary/90 ${FOCUS_RING}`}
							>
								<RefreshCw size={16} aria-hidden="true" />
								Try again
							</button>
						</div>
					)}

					{status === 'no-workspace' && (
						<div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-black/10 text-center dark:border-white/10">
							<span className="material-symbols-outlined text-[48px] text-on-surface-variant/60" aria-hidden="true">workspaces</span>
							<h2 className="text-lg font-bold text-on-surface">No workspace yet</h2>
							<p className="max-w-md text-sm text-on-surface-variant">
								Open the dashboard once to create your workspace, then come back to explore its graph.
							</p>
							<Link
								href="/"
								className={`rounded-lg bg-primary px-5 py-2.5 font-bold text-on-primary premium-transition hover:bg-primary/90 ${FOCUS_RING}`}
							>
								Go to pages
							</Link>
						</div>
					)}

					{status === 'ready' && data && <GraphView data={data} className="h-full" />}
				</section>
			</main>
		</div>
	)
}
