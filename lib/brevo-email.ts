/**
 * Confirmation-email sender for the founding waitlist (#85 option B).
 *
 * Uses Brevo's transactional API (/v3/smtp/email) — the same pipeline that
 * already delivers Supabase auth mail on this account — instead of Brevo's
 * opaque native double-opt-in. Failures throw; the waitlist service queues
 * them for retry so signups never fail because email did.
 */

import type { ConfirmEmailPayload } from '@/services/waitlist'

const BREVO_API_BASE = 'https://api.brevo.com/v3'

export function buildConfirmEmailHtml (token: string, position?: number): string {
	const url = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://lekhan.online'}/api/waitlist/confirm?token=${token}`
	const spotLine = position
		? `<p style="margin:0 0 16px;color:#5d5850">Your founding spot is <strong>№ ${position} of 500</strong>.</p>`
		: ''
	return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#f9f8f4;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid rgba(25,23,19,0.16);border-radius:8px;padding:32px">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#c96a10">Lekhan — Founding Edition</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#191713">Confirm your spot</h1>
    ${spotLine}
    <p style="margin:0 0 24px;color:#191713;line-height:1.6">One click to confirm your email address. Your invite to the private beta follows in spot-number order.</p>
    <a href="${url}" style="display:inline-block;padding:12px 24px;background:#191713;color:#f9f8f4;text-decoration:none;border-radius:6px;font-weight:500">Confirm my spot</a>
    <p style="margin:24px 0 0;font-size:13px;color:#5d5850;line-height:1.5">Didn't ask for this? Ignore this email — nothing happens until you confirm.</p>
  </div>
</body></html>`
}

export async function sendConfirmationEmail (payload: ConfirmEmailPayload): Promise<void> {
	const apiKey = process.env.BREVO_API_KEY
	const from = process.env.WAITLIST_CONFIRM_FROM
	if (!apiKey || !from) {
		throw new Error('Email sending not configured (BREVO_API_KEY / WAITLIST_CONFIRM_FROM)')
	}

	const response = await fetch(`${BREVO_API_BASE}/smtp/email`, {
		method: 'POST',
		headers: {
			'api-key': apiKey,
			'content-type': 'application/json',
			accept: 'application/json',
		},
		body: JSON.stringify({
			sender: { email: from, name: 'Lekhan' },
			to: [{ email: payload.email }],
			subject: `Confirm your founding spot${payload.position ? ` — № ${payload.position} of 500` : ''}`,
			htmlContent: buildConfirmEmailHtml(payload.token, payload.position),
		}),
	})

	if (!response.ok) {
		const detail = await response.text().catch(() => '')
		throw new Error(`Confirmation email failed (${response.status}): ${detail.slice(0, 200)}`)
	}
}
