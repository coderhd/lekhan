import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reconcileBilling } from '@/services/billing/reconciliation'

export const dynamic = 'force-dynamic'
// Bounded per-invocation sweep (MAX_WORKSPACES_PER_SWEEP provider round-trips);
// give the function room for the provider latency without hitting the default limit.
export const maxDuration = 300

async function handleBillingReconcile(req: NextRequest) {
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
		const summary = await reconcileBilling({ db: supabaseAdmin })
		const durationMs = Date.now() - startTime

		console.log(
			`[Billing Reconcile Cron] Completed sweep: ${summary.checked} checked, ${summary.converged} converged, ${summary.unchanged} unchanged, ${summary.gone} terminal, ${summary.referralsSettled} referral settlements, ${summary.failures} failures in ${durationMs}ms.`
		)

		if (summary.failures > 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Partial billing reconciliation failure',
					...summary,
					durationMs,
				},
				{ status: 500 }
			)
		}

		return NextResponse.json({ success: true, ...summary, durationMs })
	} catch (err: any) {
		console.error('[Billing Reconcile Cron] Fatal error during reconciliation:', err)
		return NextResponse.json(
			{ error: 'Internal Server Error', details: err?.message },
			{ status: 500 }
		)
	}
}

export async function POST(req: NextRequest) {
	return handleBillingReconcile(req)
}

export async function GET(req: NextRequest) {
	return handleBillingReconcile(req)
}
