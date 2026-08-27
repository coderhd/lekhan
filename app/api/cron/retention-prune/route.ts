import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import auth from '@/server/auth.js'
import retention from '@/server/retention.js'

const { getDocumentOwnerPlan } = auth
const { pruneExpiredDocumentVersions } = retention

export const dynamic = 'force-dynamic'

async function handleRetentionPrune(req: NextRequest) {
	const startTime = Date.now()
	const authHeader = req.headers.get('authorization')
	const cronSecret = process.env.CRON_SECRET

	const isAuthorized =
		(cronSecret && authHeader === `Bearer ${cronSecret}`) ||
		(cronSecret && req.nextUrl.searchParams.get('key') === cronSecret)

	if (!isAuthorized) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
	const supabaseSecretKey =
		process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

	if (!supabaseUrl || !supabaseSecretKey) {
		return NextResponse.json(
			{ error: 'Supabase server credentials missing' },
			{ status: 500 }
		)
	}

	const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	})

	try {
		// Fetch distinct document_ids with recorded versions
		const { data: versionRows, error: fetchError } = await supabaseAdmin
			.from('document_versions')
			.select('document_id')
			.order('created_at', { ascending: false })

		if (fetchError) {
			console.error('[Retention Cron] Error querying document_versions:', fetchError)
			return NextResponse.json(
				{ error: 'Database query failed', details: fetchError.message },
				{ status: 500 }
			)
		}

		const distinctDocIds = Array.from(
			new Set((versionRows || []).map((row: any) => row.document_id).filter(Boolean))
		)

		let totalPrunedDocuments = 0
		let totalPrunedVersions = 0
		const referenceNow = new Date()

		for (const docId of distinctDocIds) {
			try {
				const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, docId)
				const result = await pruneExpiredDocumentVersions(
					supabaseAdmin,
					docId,
					ownerPlan,
					referenceNow
				)

				if (result.success && result.prunedCount > 0) {
					totalPrunedDocuments += 1
					totalPrunedVersions += result.prunedCount
				}
			} catch (docErr) {
				console.warn(`[Retention Cron] Failed pruning for doc ${docId}:`, docErr)
			}
		}

		const durationMs = Date.now() - startTime
		console.log(
			`[Retention Cron] Completed sweep: ${totalPrunedDocuments} documents pruned, ${totalPrunedVersions} total versions removed in ${durationMs}ms.`
		)

		return NextResponse.json({
			success: true,
			scannedDocumentsCount: distinctDocIds.length,
			prunedDocumentsCount: totalPrunedDocuments,
			prunedVersionsCount: totalPrunedVersions,
			durationMs,
		})
	} catch (err: any) {
		console.error('[Retention Cron] Fatal error during retention pruning:', err)
		return NextResponse.json(
			{ error: 'Internal Server Error', details: err?.message },
			{ status: 500 }
		)
	}
}

export async function POST(req: NextRequest) {
	return handleRetentionPrune(req)
}

export async function GET(req: NextRequest) {
	return handleRetentionPrune(req)
}
