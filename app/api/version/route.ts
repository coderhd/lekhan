import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
	const authHeader = request.headers.get('Authorization')
	if (!authHeader) {
		return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 })
	}

	const token = authHeader.replace('Bearer ', '')

	// Initialize Supabase with the client's JWT to respect RLS
	const supabaseClient = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || '',
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)

	// Admin client for storage uploads (bypassing public write limits)
	const supabaseAdmin = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL || '',
		process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		}
	)

	try {
		const { data: { user } } = await supabaseClient.auth.getUser()
		if (!user) {
			return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		}

		const { documentId, versionName, base64State } = await request.json()

		if (!documentId || !versionName || !base64State) {
			return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
		}

		// 1. Verify user role: only owners and editors can create versions
		const { data: doc } = await supabaseClient
			.from('documents')
			.select('owner_id')
			.eq('id', documentId)
			.single()

		const isOwner = doc && doc.owner_id === user.id
		let isEditor = false

		if (!isOwner) {
			const { data: member } = await supabaseClient
				.from('document_members')
				.select('role')
				.eq('document_id', documentId)
				.eq('user_id', user.id)
				.single()

			isEditor = !!(member && member.role === 'editor')
		}

		if (!isOwner && !isEditor) {
			return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 })
		}

		// 2. Create the document_versions record
		const { data: version, error: dbError } = await supabaseClient
			.from('document_versions')
			.insert({
				document_id: documentId,
				version_name: versionName,
				created_by: user.id,
			})
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
