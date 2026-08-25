/**
 * Thin Brevo contacts-API wrapper (#85). All network failure modes throw;
 * callers decide persistence strategy (the waitlist service queues an
 * outbox row so signups never fail because Brevo did).
 */

import type { BrevoContactPayload } from '@/services/waitlist'

const BREVO_API_BASE = 'https://api.brevo.com/v3'
// A stalled Brevo must not stall the signup request; the timeout rejection
// routes into the outbox fallback like any other failure.
const REQUEST_TIMEOUT_MS = 10_000

export async function syncBrevoContact (payload: BrevoContactPayload): Promise<void> {
	const apiKey = process.env.BREVO_API_KEY
	if (!apiKey) {
		// No key configured yet: surface as failure so the outbox catches it
		// and the signup still succeeds. Retry drains once the key lands.
		throw new Error('BREVO_API_KEY not configured')
	}

	const response = await fetch(`${BREVO_API_BASE}/contacts`, {
		method: 'POST',
		headers: {
			'api-key': apiKey,
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	})

	// 409 = contact already exists; with updateEnabled:true this only happens
	// on a concurrent create, which counts as synced.
	if (!response.ok && response.status !== 409) {
		const detail = await response.text().catch(() => '')
		throw new Error(`Brevo contact sync failed (${response.status}): ${detail.slice(0, 200)}`)
	}
}
