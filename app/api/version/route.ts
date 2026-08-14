import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readJsonWithLimit, PayloadTooLargeError } from '@/lib/request-limits'

// A Yjs snapshot for even a very large document is realistically a few MB.
// 20MB of decoded binary (~27MB base64) gives generous headroom without
// leaving the endpoint open to arbitrary-size payloads.
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024
const MAX_VERSION_NAME_LENGTH = 200

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

	// Initialize Supabase with the client's JWT to respect RLS
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
	// Admin client for storage uploads (bypassing public write limits)
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

		let documentId: string, versionName: string, base64State: string
		try {
			const body = await readJsonWithLimit<{
				documentId?: string
				versionName?: string
				base64State?: string
			}>(request, MAX_SNAPSHOT_BYTES)
			documentId = body.documentId ?? ''
			versionName = body.versionName ?? ''
			base64State = body.base64State ?? ''
		} catch (err) {
			if (err instanceof PayloadTooLargeError) {
				return NextResponse.json({ error: 'Snapshot payload too large' }, { status: 413 })
			}
			return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
		}

		if (!documentId || !versionName || !base64State) {
			return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
		}

		if (versionName.length > MAX_VERSION_NAME_LENGTH) {
			return NextResponse.json(
				{ error: `versionName exceeds maximum length of ${MAX_VERSION_NAME_LENGTH} characters` },
				{ status: 400 }
			)
		}

		// Reject before allocating the decoded Buffer: base64 is ~4/3 the size
		// of the decoded bytes, so this catches an oversized payload that slid
		// in under MAX_SNAPSHOT_BYTES as raw body but decodes to something
		// larger than intended, and generally avoids Buffer.from() being the
		// first place size is ever checked.
		const estimatedDecodedBytes = (base64State.length * 3) / 4
		if (estimatedDecodedBytes > MAX_SNAPSHOT_BYTES) {
			return NextResponse.json({ error: 'Document snapshot exceeds maximum allowed size' }, { status: 413 })
		}

		// 1. Verify user role: only owners and editors can create versions.
		// Pages are the primary entity; legacy documents fall back for
		// unmapped ids (rollback path). The page lookup must be trusted
		// (service-role, RLS-bypassing): an RLS-filtered null here would also
		// mean "no access", and legacy documents share the id space with pages
		// (P1 backfill kept twin records), so an authorized legacy-document
		// user could otherwise slip past page authorization.
		const { data: page } = await supabaseAdmin
			.from('pages')
			.select('id')
			.eq('id', documentId)
			.maybeSingle()

		let isOwner = false
		let isEditor = false

		if (page) {
			// Page path: authorize through the caller-scoped client so RLS
			// still gates what the caller can see.
			const { data: pageRow } = await supabaseClient
				.from('pages')
				.select('owner_id')
				.eq('id', documentId)
				.maybeSingle()

			isOwner = !!(pageRow && pageRow.owner_id === user.id)

			if (!isOwner) {
				const { data: member } = await supabaseClient
					.from('page_members')
					.select('role')
					.eq('page_id', documentId)
					.eq('user_id', user.id)
					.single()

				isEditor = !!(member && member.role === 'editor')
			}
		} else {
			const { data: doc } = await supabaseClient
				.from('documents')
				.select('owner_id')
				.eq('id', documentId)
				.maybeSingle()

			isOwner = !!(doc && doc.owner_id === user.id)

			if (!isOwner && doc) {
				const { data: member } = await supabaseClient
					.from('document_members')
					.select('role')
					.eq('document_id', documentId)
					.eq('user_id', user.id)
					.single()

				isEditor = !!(member && member.role === 'editor')
			}
		}

		if (!isOwner && !isEditor) {
			return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 })
		}

		// 2. Create the document_versions record (page_id for pages)
		const { data: version, error: dbError } = await supabaseClient
			.from('document_versions')
			.insert(
				page
					? {
						page_id: documentId,
						version_name: versionName,
						created_by: user.id,
					}
					: {
						document_id: documentId,
						version_name: versionName,
						created_by: user.id,
					}
			)
			.select()
			.single()

		if (dbError || !version) {
			throw dbError || new Error('Failed to insert version metadata')
		}

		// 3. Upload binary snapshot to Supabase Object Storage
		const buffer = Buffer.from(base64State, 'base64')
		const { error: uploadError } = await supabaseAdmin.storage
			.from('documents')
			.upload(`${documentId}/versions/${version.id}.bin`, buffer, {
				contentType: 'application/octet-stream',
				upsert: true,
			})

		if (uploadError) {
			// Rollback DB insert
			await supabaseClient.from('document_versions').delete().eq('id', version.id)
			throw uploadError
		}

		return NextResponse.json({ success: true, version })
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err)
		console.error('[API Version Error]', err)
		return NextResponse.json({ error: message || 'Internal server error' }, { status: 500 })
	}
}
