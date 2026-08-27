import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import auth from '@/server/auth.js'
import retention from '@/server/retention.js'

const { getDocumentOwnerPlan } = auth
const { pruneExpiredDocumentVersions } = retention

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 100

async function handleRetentionPrune(req: NextRequest) {
	const startTime = Date.now()
	const authHeader = req.headers.get('authorization')
	const cronSecret = process.env.CRON_SECRET

	// Authenticate strictly via Authorization Bearer header
	const isAuthorized = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`)

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
		let totalScannedDocuments = 0
		let totalPrunedDocuments = 0
		let totalPrunedVersions = 0
		const failedDocumentIds: string[] = []
		const referenceNow = new Date()

		// Process documents in bounded cursor-based batches across pages
		let pageOffset = 0
		let hasMore = true

		while (hasMore) {
			const { data: pageRows, error: fetchError } = await supabaseAdmin
				.from('pages')
				.select('id')
				.range(pageOffset, pageOffset + BATCH_SIZE - 1)

			if (fetchError) {
				console.error('[Retention Cron] Error querying pages batch:', fetchError)
				return NextResponse.json(
					{ error: 'Database query failed', details: fetchError.message },
					{ status: 500 }
				)
			}

			if (!pageRows || pageRows.length === 0) {
				hasMore = false
				break
			}

			totalScannedDocuments += pageRows.length

			for (const page of pageRows) {
				const docId = page.id
				try {
					const ownerPlan = await getDocumentOwnerPlan(supabaseAdmin, docId)
					const result = await pruneExpiredDocumentVersions(
						supabaseAdmin,
						docId,
						ownerPlan,
						referenceNow
					)

					if (result && result.success) {
						if (result.prunedCount > 0) {
							totalPrunedDocuments += 1
							totalPrunedVersions += result.prunedCount
						}
					} else {
						failedDocumentIds.push(docId)
					}
				} catch (docErr) {
					console.warn(`[Retention Cron] Failed pruning for doc ${docId}:`, docErr)
					failedDocumentIds.push(docId)
				}
			}

			if (pageRows.length < BATCH_SIZE) {
				hasMore = false
			} else {
				pageOffset += BATCH_SIZE
			}
		}

		const durationMs = Date.now() - startTime
		console.log(
			`[Retention Cron] Completed sweep: ${totalPrunedDocuments} documents pruned, ${totalPrunedVersions} total versions removed, ${failedDocumentIds.length} failures in ${durationMs}ms.`
		)

		if (failedDocumentIds.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Partial retention prune failure',
					scannedDocumentsCount: totalScannedDocuments,
					prunedDocumentsCount: totalPrunedDocuments,
					prunedVersionsCount: totalPrunedVersions,
					failedDocumentIds,
					durationMs,
				},
				{ status: 500 }
			)
		}

		return NextResponse.json({
			success: true,
			scannedDocumentsCount: totalScannedDocuments,
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
