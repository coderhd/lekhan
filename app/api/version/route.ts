import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readJsonWithLimit, PayloadTooLargeError } from '@/lib/request-limits'
import { encryptSnapshot, decryptSnapshot } from '@/lib/server-crypto'

// A Yjs snapshot for even a very large document is realistically a few MB.
// 20MB of decoded binary (~27MB base64) gives generous headroom without
// leaving the endpoint open to arbitrary-size payloads.
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024
const MAX_VERSION_NAME_LENGTH = 200

function createClients(token: string) {
	const supabaseKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		''

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

	return { supabaseClient, supabaseAdmin }
}

export async function POST(request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')
	const { supabaseClient, supabaseAdmin } = createClients(token)

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

		const estimatedDecodedBytes = (base64State.length * 3) / 4
		if (estimatedDecodedBytes > MAX_SNAPSHOT_BYTES) {
			return NextResponse.json({ error: 'Document snapshot exceeds maximum allowed size' }, { status: 413 })
		}

		// 1. Verify user role: only owners and editors can create versions.
		const { data: page } = await supabaseAdmin
			.from('pages')
			.select('id')
			.eq('id', documentId)
			.maybeSingle()

		let isOwner = false
		let isEditor = false

		if (page) {
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

		// 2. Create the document_versions record
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

		// 3. Encrypt snapshot and upload to Supabase Object Storage (ADR 0001)
		const rawBuffer = Buffer.from(base64State, 'base64')
		const encryptedBuffer = encryptSnapshot(rawBuffer)

		const { error: uploadError } = await supabaseAdmin.storage
			.from('documents')
			.upload(`${documentId}/versions/${version.id}.bin`, encryptedBuffer, {
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

export async function GET(request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')
	const { supabaseClient, supabaseAdmin } = createClients(token)

	try {
		const { data: { user } } = await supabaseClient.auth.getUser()
		if (!user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}

		const documentId = request.nextUrl.searchParams.get('documentId')
		const versionId = request.nextUrl.searchParams.get('versionId')

		if (!documentId || !versionId) {
			return NextResponse.json({ error: 'Missing documentId or versionId query parameter' }, { status: 400 })
		}

		// Verify user has read access to the page/document (owner, member, or public)
		const { data: page } = await supabaseAdmin
			.from('pages')
			.select('id, is_public, owner_id')
			.eq('id', documentId)
			.maybeSingle()

		let canRead = false
		if (page) {
			if (page.is_public || page.owner_id === user.id) {
				canRead = true
			} else {
				const { data: member } = await supabaseClient
					.from('page_members')
					.select('role')
					.eq('page_id', documentId)
					.eq('user_id', user.id)
					.maybeSingle()
				canRead = !!member
			}
		} else {
			const { data: doc } = await supabaseAdmin
				.from('documents')
				.select('id, is_public, owner_id')
				.eq('id', documentId)
				.maybeSingle()

			if (doc) {
				if (doc.is_public || doc.owner_id === user.id) {
					canRead = true
				} else {
					const { data: member } = await supabaseClient
						.from('document_members')
						.select('role')
						.eq('document_id', documentId)
						.eq('user_id', user.id)
						.maybeSingle()
					canRead = !!member
				}
			}
		}

		if (!canRead) {
			return NextResponse.json({ error: 'Forbidden: Insufficient permissions to view version' }, { status: 403 })
		}

		// Download binary from storage and decrypt at rest (ADR 0001)
		const { data, error } = await supabaseAdmin.storage
			.from('documents')
			.download(`${documentId}/versions/${versionId}.bin`)

		if (error || !data) {
			return NextResponse.json({ error: 'Version binary not found' }, { status: 404 })
		}

		const arrayBuffer = await data.arrayBuffer()
		const decrypted = decryptSnapshot(Buffer.from(arrayBuffer))

		return new Response(new Uint8Array(decrypted), {
			status: 200,
			headers: {
				'Content-Type': 'application/octet-stream',
				'Cache-Control': 'no-store',
			},
		})
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err)
		console.error('[API Version GET Error]', err)
		return NextResponse.json({ error: message || 'Internal server error' }, { status: 500 })
	}
}
