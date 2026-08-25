import { NextRequest, NextResponse } from 'next/server'
import { confirmByToken } from '@/services/waitlist'
import { supabase } from '@/lib/supabase'

/**
 * GET /api/waitlist/confirm?token=… — the double-opt-in landing (#85 option B).
 * A GET link so it works with zero JS. Token is single-use (RPC flips
 * confirmed_at only when still null); reuse shows a friendly no-op.
 */
export async function GET (request: NextRequest) {
	const token = new URL(request.url).searchParams.get('token') ?? ''

	try {
		const result = await confirmByToken(
			{
				dbConfirm: async t => {
					const { data, error } = await supabase.rpc('confirm_waitlist', { p_token: t })
					if (error) throw new Error(error.message)
					const row = Array.isArray(data) ? data[0] : data
					return row ? { spot: Number(row.spot), email: String(row.email) } : null
				},
			},
			token,
		)

		if (result.alreadyConfirmed) {
			return htmlResponse(
				'Already confirmed',
				'This link was already used or is not valid. If you never confirmed and need a new email, just reply to any waitlist email.',
				200,
			)
		}

		return htmlResponse(
			`You're in — spot № ${result.position} of 500`,
			`${escapeHtml(result.email ?? '')} is confirmed. Your invite to the private beta follows in spot-number order.`,
			200,
		)
	} catch {
		return htmlResponse('Something went wrong', 'Please try again in a minute.', 500)
	}
}

// Email addresses are user input stored at signup; they must never reach the
// page raw. validateEmail permits <, >, /, = and quotes.
function escapeHtml (value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function htmlResponse (title: string, body: string, status: number): NextResponse {
	const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Lekhan</title></head>
<body style="margin:0;padding:32px;background:#f9f8f4;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:48px auto;background:#fff;border:1px solid rgba(25,23,19,0.16);border-radius:8px;padding:32px">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#c96a10">Lekhan — Founding Edition</p>
<h1 style="margin:0 0 12px;font-size:22px;color:#191713">${title}</h1>
<p style="margin:0;color:#5d5850;line-height:1.6">${body}</p>
</div></body></html>`
	return new NextResponse(html, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8' },
	})
}
