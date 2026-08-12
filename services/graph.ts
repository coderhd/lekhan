import { supabase } from '@/lib/supabase'
import { Backlink, Page, PageLink, PageTag, Workspace } from '@/types'

export async function fetchWorkspaces (userId: string): Promise<Workspace[]> {
	const { data, error } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as Workspace[]) || []
}

export async function fetchWorkspacePages (workspaceId: string): Promise<Page[]> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('workspace_id', workspaceId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as Page[]) || []
}

export async function createPage (
	workspaceId: string,
	ownerId: string,
	parentId: string | null = null
): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.insert({
			workspace_id: workspaceId,
			owner_id: ownerId,
			parent_id: parentId,
			title: 'Untitled',
		})
		.select()
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function updatePageTitle (pageId: string, title: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ title })
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function deletePage (pageId: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.delete()
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function updatePagePublicStatus (pageId: string, isPublic: boolean): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ is_public: isPublic })
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function fetchPageDetails (pageId: string): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('id', pageId)
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function fetchPageBacklinks (pageId: string): Promise<Backlink[]> {
	const { data, error } = await supabase
		.from('page_links')
		.select('from_page_id, pages!page_links_from_page_id_fkey (title)')
		.eq('to_page_id', pageId)

	if (error) {
		throw error
	}
	return ((data as Array<{ from_page_id: string; pages: { title: string } | null; from_title?: string }>) || [])
		.filter(row => row.pages || row.from_title)
		.map(row => ({
			from_page_id: row.from_page_id,
			from_title: row.pages ? row.pages.title : (row.from_title as string),
		}))
}

export async function fetchPageTags (pageId: string): Promise<PageTag[]> {
	const { data, error } = await supabase
		.from('page_tags')
		.select('*')
		.eq('page_id', pageId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as PageTag[]) || []
}

export async function fetchWorkspaceGraph (workspaceId: string): Promise<{ pages: Page[]; links: PageLink[] }> {
	const [pagesResult, linksResult] = await Promise.all([
		supabase.from('pages').select('*').eq('workspace_id', workspaceId),
		supabase.from('page_links').select('*').eq('workspace_id', workspaceId),
	])

	if (pagesResult.error) {
		throw pagesResult.error
	}
	if (linksResult.error) {
		throw linksResult.error
	}
	return {
		pages: (pagesResult.data as Page[]) || [],
		links: (linksResult.data as PageLink[]) || [],
	}
}