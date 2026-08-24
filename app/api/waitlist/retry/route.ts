import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { retryBrevoOutbox, type BrevoContactPayload, type ConfirmEmailPayload, type OutboxKind } from '@/services/waitlist'
import { syncBrevoContact } from '@/lib/brevo'
import { sendConfirmationEmail } from '@/lib/brevo-email'

/**
 * Outbox retry drain (#85). All decisions live in the (unit-tested) service;
 * this handler only wires Supabase rows to it. Guarded by a shared secret so
 * only the cron worker can trigger it; returns 404 (not 403) when
 * unauthenticated so the endpoint doesn't advertise itself.
 *
 * The confirmation-email landing lives at /api/waitlist/confirm (GET, public).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY =
	process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export async function POST (request: NextRequest) {
	const secret = process.env.WAITLIST_RETRY_SECRET
	if (!secret || request.headers.get('x-waitlist-secret') !== secret) {
		return new NextResponse(null, { status: 404 })
	}
	if (!SERVICE_KEY) {
		return NextResponse.json({ error: 'Service role not configured' }, { status: 500 })
	}

	const admin = createClient(SUPABASE_URL, SERVICE_KEY)

	try {
		const { data: pending, error } = await admin
			.from('brevo_outbox')
			.select('id, waitlist_id, payload, kind, attempts')
			.is('synced_at', null)
			.order('created_at')
			.limit(50)
		if (error) throw new Error(error.message)

		let synced = 0
		let failed = 0

		await retryBrevoOutbox({
			brevoSync: syncBrevoContact,
			emailSender: sendConfirmationEmail,
			listPendingBrevo: async () =>
				((pending ?? []) as Array<{ id: number; waitlist_id: number; payload: unknown; kind: string }>).map(row => ({
					id: Number(row.id),
					waitlistId: Number(row.waitlist_id),
					kind: (row.kind === 'confirm_email' ? 'confirm_email' : 'contact_sync') as OutboxKind,
					payload: row.payload as BrevoContactPayload | ConfirmEmailPayload,
				})),
			markBrevoSynced: async rowId => {
				await admin.from('brevo_outbox').update({ synced_at: new Date().toISOString() }).eq('id', rowId)
				synced++
			},
			recordBrevoFailure: async (rowId, message) => {
				const current = (pending ?? []).find(r => Number(r.id) === rowId)
				await admin
					.from('brevo_outbox')
					.update({
						attempts: (Number((current as { attempts?: number } | undefined)?.attempts) || 0) + 1,
						last_error: message.slice(0, 300),
					})
					.eq('id', rowId)
				failed++
			},
		})

		return NextResponse.json({ synced, failed, considered: pending?.length ?? 0 })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return NextResponse.json({ error: message }, { status: 500 })
	}
}
