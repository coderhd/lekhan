import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readJsonWithLimit, PayloadTooLargeError } from '@/lib/request-limits'
import { encryptSnapshot } from '@/lib/server-crypto'
import graphIndex from '../../../server/graph-index.js'

// The import payload is the base64-encoded IR. A 64 MB ceiling keeps peak
// request memory bounded (readJsonWithLimit buffers, copies and parses the
// body) while comfortably holding ~2,000 typical note snapshots (~27 MB).
// Vaults whose encoded IR exceeds this MUST be split by the caller into
// multiple POST /api/import batches — each batch is independent and complete
// (folder chains are deduped/reused server-side), so batching preserves full
// coverage. The batching client lands with the import UX (#63).
const MAX_IMPORT_PAYLOAD_BYTES = 64 * 1024 * 1024
// Mirrors MAX_IMPORT_PAGES in services/obsidian-import.ts (kept local so the
// server bundle does not pull browser ingestion code).
const MAX_IMPORT_PAGES = 2000
// A single imported page's Yjs state is realistically small; this mirrors the
// per-snapshot ceiling used by /api/version.
const MAX_PAGE_SNAPSHOT_BYTES = 20 * 1024 * 1024
// Leaf pages are inserted in chunks to bound individual statement sizes.
const INSERT_CHUNK_SIZE = 500

interface ImportPageInput {
	title?: unknown
	folderPath?: unknown
	properties?: unknown
	tags?: unknown
	contentYjsBase64?: unknown
	plainText?: unknown
	isFolder?: unknown
}

interface ImportBody {
	workspaceId?: unknown
	pages?: unknown
}

interface ResolvedPage {
	title: string
	folderPath: string | null
	properties: Record<string, unknown>
	contentYjsBase64: string
	plainText: string
}

export async function POST(request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')

	const supabaseKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		''

	// Caller-scoped client: proves who the caller is (JWT verification).
	const supabaseClient = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || '',
		supabaseKey,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					apikey: supabaseKey,
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)

	const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
	// Admin client: trusted lookups, page creation, storage writes, indexing.
	const supabaseAdmin = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || '',
		serviceRoleKey,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					apikey: serviceRoleKey,
				},
			},
		}
	)

	try {
		const { data: { user } } = await supabaseClient.auth.getUser()
		if (!user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}

		let body: ImportBody
		try {
			body = await readJsonWithLimit<ImportBody>(request, MAX_IMPORT_PAYLOAD_BYTES)
		} catch (err) {
			if (err instanceof PayloadTooLargeError) {
				return NextResponse.json({ error: 'Import payload too large' }, { status: 413 })
			}
			return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
		}

		const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : ''
		if (!workspaceId) {
			return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
		}

		if (!Array.isArray(body.pages) || body.pages.length === 0) {
			return NextResponse.json({ error: 'Import must contain at least one page' }, { status: 400 })
		}
		if (body.pages.length > MAX_IMPORT_PAGES) {
			return NextResponse.json(
				{ error: `Import exceeds maximum of ${MAX_IMPORT_PAGES} pages` },
				{ status: 400 }
			)
		}

		// Validate + normalize every page before touching the database so a bad
		// entry deep in the payload cannot leave a half-written import behind.
		const pages: ResolvedPage[] = []
		for (const [index, raw] of body.pages.entries()) {
			const page = raw as ImportPageInput
			const title = typeof page.title === 'string' ? page.title.trim() : ''
			const contentYjsBase64 = typeof page.contentYjsBase64 === 'string' ? page.contentYjsBase64 : ''
			if (!title || !contentYjsBase64) {
				return NextResponse.json(
					{ error: `Page at index ${index} is missing a title or Yjs state` },
					{ status: 400 }
				)
			}
			// Same base64-inflation guard as /api/version, applied per page.
			const estimatedDecodedBytes = (contentYjsBase64.length * 3) / 4
			if (estimatedDecodedBytes > MAX_PAGE_SNAPSHOT_BYTES) {
				return NextResponse.json(
					{ error: `Page "${title}" exceeds the maximum snapshot size` },
					{ status: 413 }
				)
			}
			pages.push({
				title,
				folderPath: typeof page.folderPath === 'string' && page.folderPath ? page.folderPath : null,
				properties: (page.properties && typeof page.properties === 'object' && !Array.isArray(page.properties))
					? page.properties as Record<string, unknown>
					: {},
				contentYjsBase64,
				plainText: typeof page.plainText === 'string' ? page.plainText : '',
			})
		}

		// Trusted ownership check (service-role, RLS-bypassing): the caller must
		// own the target workspace to import into it.
		const { data: workspace } = await supabaseAdmin
			.from('workspaces')
			.select('owner_id')
			.eq('id', workspaceId)
			.maybeSingle()

		if (!workspace) {
			return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
		}
		if (workspace.owner_id !== user.id) {
			return NextResponse.json({ error: 'Forbidden: Only the workspace owner can import' }, { status: 403 })
		}

		// Existing workspace pages serve two purposes: reusing folder-page
		// chains across repeated imports, and resolving parent ids.
		// Existing workspace pages: only pages explicitly marked as import
		// folder-pages (properties.importFolder) are reusable as folder chain
		// targets — an ordinary note that happens to share a folder's title
		// must never become a hierarchy parent.
		const { data: existingPages, error: fetchError } = await supabaseAdmin
			.from('pages')
			.select('id, title, parent_id, properties')
			.eq('workspace_id', workspaceId)

		if (fetchError) {
			throw fetchError
		}

		const folderKey = (parentId: string | null, title: string) =>
			`${parentId ?? 'root'}|${graphIndex.normalizeTitle(title)}`
		const existingByFolderKey = new Map<string, string>()
		for (const row of existingPages ?? []) {
			const props = (row.properties && typeof row.properties === 'object') ? row.properties as Record<string, unknown> : {}
			if (props.importFolder !== true) {
				continue
			}
			existingByFolderKey.set(folderKey(row.parent_id ?? null, row.title ?? ''), row.id)
		}

		// Folder-page chains created during THIS request (path → id), so many
		// notes sharing a folderPath create each folder-page exactly once.
		const chainCache = new Map<string, string>()

		const ensureFolderChain = async (folderPath: string | null): Promise<string | null> => {
			if (!folderPath) {
				return null
			}
			let parentId: string | null = null
			let accumulated = ''
			for (const segment of folderPath.split('/')) {
				accumulated = accumulated ? `${accumulated}/${segment}` : segment
				const key = folderKey(parentId, segment)
				let pageId: string | undefined = chainCache.get(accumulated) ?? existingByFolderKey.get(key)
				if (!pageId) {
					const result = await supabaseAdmin
						.from('pages')
						.insert({
							workspace_id: workspaceId,
							owner_id: user.id,
							title: segment,
							parent_id: parentId ?? undefined,
							properties: { importFolder: true },
						})
						.select('id')
						.single()
					const created = result.data as { id: string } | null
					if (result.error || !created) {
						throw result.error || new Error(`Failed to create folder page "${segment}"`)
					}
					pageId = created.id
					existingByFolderKey.set(key, pageId)
				}
				chainCache.set(accumulated, pageId)
				parentId = pageId
			}
			return parentId
		}

		// Resolve every leaf's parent first (creating folder-pages as needed),
		// so all leaf rows exist in one shape before batching.
		const pendingLeaves: Array<{ row: Record<string, unknown>; source: ResolvedPage }> = []
		for (const page of pages) {
			const parentId = await ensureFolderChain(page.folderPath)
			pendingLeaves.push({
				row: {
					workspace_id: workspaceId,
					owner_id: user.id,
					title: page.title,
					parent_id: parentId,
					properties: page.properties,
				},
				source: page,
			})
		}

		// Chunked batch insert. PostgREST returns rows in insertion order, which
		// the zip below relies on to map generated ids back to sources.
		const createdLeaves: Array<{ id: string; source: ResolvedPage }> = []
		for (let offset = 0; offset < pendingLeaves.length; offset += INSERT_CHUNK_SIZE) {
			const chunk = pendingLeaves.slice(offset, offset + INSERT_CHUNK_SIZE)
			const { data: insertedRows, error: insertError } = await supabaseAdmin
				.from('pages')
				.insert(chunk.map(entry => entry.row))
				.select('id')

			if (insertError || !insertedRows || insertedRows.length !== chunk.length) {
				throw insertError || new Error('Page insertion returned an unexpected number of rows')
			}
			insertedRows.forEach((row: { id: string }, i: number) => {
				createdLeaves.push({ id: row.id, source: chunk[i].source })
			})
		}

		// Persist each page's Yjs state with bounded concurrency, then index
		// the whole batch in one pass (graph-index.indexPages loads each page
		// row and the workspace title index once instead of per page). A page
		// whose snapshot or indexing fails does not abort the import — it is
		// reported as a warning so the client's report can surface exactly
		// what needs attention; failures stay isolated to their own leaf.
		const UPLOAD_CONCURRENCY = 6

		const uploadOutcomes = new Map<number, { error?: unknown }>()
		let cursor = 0
		const workerCount = Math.min(UPLOAD_CONCURRENCY, createdLeaves.length)
		const workers = Array.from({ length: workerCount }, async () => {
			while (cursor < createdLeaves.length) {
				const index = cursor++
				const leaf = createdLeaves[index]
				try {
					const rawBuffer = Buffer.from(leaf.source.contentYjsBase64, 'base64')
					const encryptedBuffer = encryptSnapshot(rawBuffer)
					const { error: uploadError } = await supabaseAdmin.storage
						.from('documents')
						.upload(`${leaf.id}/main_state.bin`, encryptedBuffer, {
							contentType: 'application/octet-stream',
							upsert: true,
						})
					if (uploadError) {
						throw uploadError
					}
					uploadOutcomes.set(index, {})
				} catch (err) {
					uploadOutcomes.set(index, { error: err })
				}
			}
		})
		await Promise.all(workers)

		const warnings: Array<{ title: string; stage: string; error: string }> = []
		const createdPages: Array<{ id: string; title: string }> = []
		const indexItems: Array<{ pageId: string; plainText: string }> = []

		for (const [index, leaf] of createdLeaves.entries()) {
			const outcome = uploadOutcomes.get(index)
			if (outcome?.error) {
				warnings.push({
					title: leaf.source.title,
					stage: 'snapshot',
					error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
				})
				continue
			}
			createdPages.push({ id: leaf.id, title: leaf.source.title })
			indexItems.push({ pageId: leaf.id, plainText: leaf.source.plainText })
		}

		const { errors: indexErrors } = await graphIndex.indexPages(supabaseAdmin, indexItems)
		for (const indexError of indexErrors) {
			warnings.push({
				title: createdLeaves.find(leaf => leaf.id === indexError.pageId)?.source.title ?? '',
				stage: 'index',
				error: indexError.error,
			})
		}

		return NextResponse.json({
			success: true,
			importedCount: createdPages.length,
			pages: createdPages,
			warnings,
		})
	} catch (err: unknown) {
		// Log the detail server-side; never echo internal error messages back.
		console.error('[API Import Error]', err)
		return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
	}
}
