import { NextRequest, NextResponse } from 'next/server'
import { joinWaitlist, FOUNDING_COHORT_CAP, type WaitlistDeps } from '@/services/waitlist'
import { syncBrevoContact } from '@/lib/brevo'
import { sendConfirmationEmail } from '@/lib/brevo-email'
import { supabase } from '@/lib/supabase'

/**
 * Founding-cohort waitlist endpoint (#85).
 *
 * - JSON POST → JSON contract { position, alreadyJoined, foundingFull, cap }
 * - No-JS form POST (urlencoded + text/html accept) → 303 redirect back to
 *   /early?joined=<spot> so progressive enhancement works without JS.
 *
 * Brevo failures are absorbed by the service (outbox row); they never fail
 * the signup. The retry drain lives at /api/waitlist/retry (cron-guarded).
 */

// Best-effort burst protection. In-memory means per-instance state; it blunts
// casual abuse and accidental double-clicks. Real DDoS belongs to the edge.
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 10
const hits = new Map<string, number[]>()

function rateLimited (ip: string): boolean {
	const now = Date.now()
	const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
	if (recent.length >= MAX_PER_WINDOW) {
		hits.set(ip, recent)
		return true
	}
	recent.push(now)
	hits.set(ip, recent)
	return false
}

function buildDeps (): WaitlistDeps {
	return {
		dbJoin: async (email, referredBy, utmSource, useCase) => {
			const { data, error } = await supabase.rpc('join_waitlist', {
				p_email: email,
				p_referred_by: referredBy ?? null,
				p_utm_source: utmSource ?? null,
				p_use_case: useCase ?? null,
			})
			if (error) throw new Error(`waitlist rpc failed: ${error.message}`)
			const row = Array.isArray(data) ? data[0] : data
			return {
				spot: Number(row?.spot ?? 0),
				already_joined: Boolean(row?.already_joined),
				member_id: Number(row?.member_id ?? 0),
				token: row?.token != null ? String(row.token) : null,
			}
		},
		brevoSync: syncBrevoContact,
		emailSender: sendConfirmationEmail,
		outboxEnqueue: async (waitlistId, kind, payload) => {
			const { error } = await supabase.from('brevo_outbox').insert({ waitlist_id: waitlistId, kind, payload })
			if (error) {
				// Must not fail the signup, but a lost outbox row means a lost
				// email — make it visible in logs.
				console.error('[waitlist] outbox enqueue failed:', error.message)
			}
		},
	}
}

export async function POST (request: NextRequest) {
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
	if (rateLimited(ip)) {
		return NextResponse.json(
			{ error: 'Too many attempts. Try again in a few minutes.' },
			{ status: 429 },
		)
	}

	const url = new URL(request.url)
	const contentType = request.headers.get('content-type') ?? ''
	const formMode =
		contentType.includes('application/x-www-form-urlencoded') &&
		(request.headers.get('accept') ?? '').includes('text/html')

	let email = ''
	let useCase: string | undefined
	let bodyRef: string | undefined
	let bodyUtm: string | undefined
	try {
		if (formMode) {
			const form = await request.formData()
			email = String(form.get('email') ?? '')
			useCase = String(form.get('use_case') ?? '') || undefined
			bodyRef = String(form.get('ref') ?? '') || undefined
			bodyUtm = String(form.get('utm_source') ?? '') || undefined
		} else {
			const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
			email = typeof body.email === 'string' ? body.email : ''
			useCase = typeof body.use_case === 'string' ? body.use_case : undefined
			bodyRef = typeof body.ref === 'string' ? body.ref : undefined
			bodyUtm = typeof body.utm_source === 'string' ? body.utm_source : undefined
		}
	} catch {
		email = ''
	}

	// Attribution: campaign links carry ?ref=x|linkedin|instagram and/or
	// ?utm_source=…; body values (widget-supplied) win over the link defaults.
	// ref and utm_source stay separate all the way to their own columns.
	const ref = bodyRef ?? url.searchParams.get('ref') ?? undefined
	const utmSource = bodyUtm ?? url.searchParams.get('utm_source') ?? undefined

	try {
		const result = await joinWaitlist(buildDeps(), { email, ref, utmSource, useCase })

		if (formMode) {
			const target = new URL('/early', url.origin)
			target.searchParams.set('joined', String(result.position))
			if (result.foundingFull) target.searchParams.set('wave2', '1')
			return new NextResponse(null, { status: 303, headers: { location: target.toString() } })
		}

		return NextResponse.json({
			position: result.position,
			alreadyJoined: result.alreadyJoined,
			foundingFull: result.foundingFull,
			cap: FOUNDING_COHORT_CAP,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('Invalid email')) {
			return NextResponse.json(
				{ error: 'Please enter a valid email address.' },
				{ status: 400 },
			)
		}
		console.error('[waitlist] signup failed:', message)
		return NextResponse.json(
			{ error: 'Something went wrong on our side. Please try again.' },
			{ status: 500 },
		)
	}
}
