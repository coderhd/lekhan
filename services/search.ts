import { supabase } from '@/lib/supabase'
import { Page, SearchResult } from '@/types'
import { ensureWorkspace, fetchSharedPages, fetchWorkspacePages } from '@/services/graph'

export async function searchPages (query: string, limit = 15): Promise<SearchResult[]> {
	const { data, error } = await supabase.rpc('search_pages', { p_query: query, p_limit: limit })

	if (error) {
		throw error
	}
	return (data as SearchResult[]) || []
}

export async function fetchRecentPages (userId: string, limit = 8): Promise<Page[]> {
	const workspace = await ensureWorkspace(userId)
	const [owned, shared] = await Promise.all([
		fetchWorkspacePages(workspace.id),
		fetchSharedPages(userId),
	])

	const seen = new Set<string>()
	const merged: Page[] = []
	for (const page of [...owned, ...shared.map(item => item.pages)]) {
		if (seen.has(page.id)) continue
		seen.add(page.id)
		merged.push(page)
	}
	merged.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
	return merged.slice(0, limit)
}
