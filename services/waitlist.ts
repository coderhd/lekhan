/**
 * Founding-cohort waitlist domain logic (#85).
 *
 * The database owns the hard invariants (unique email, monotonic spot numbers,
 * the 500 cap being soft) via the `join_waitlist` RPC; this module owns input
 * hygiene, the Brevo contract, and the guarantee that Brevo outages never
 * fail a signup (outbox row instead).
 *
 * All side effects are injected so the whole flow is unit-testable.
 */

export const FOUNDING_COHORT_CAP = 500

export interface WaitlistJoinInput {
	email: string
	ref?: string | null
	utmSource?: string | null
	useCase?: string | null
}

export interface WaitlistJoinResult {
	position: number
	alreadyJoined: boolean
	foundingFull: boolean
}

export interface BrevoContactPayload {
	email: string
	updateEnabled: boolean
	doubleOptin: boolean
	attributes: Record<string, string>
}

export interface PendingBrevoRow {
	id: number
	waitlistId: number
	payload: BrevoContactPayload
}

export interface WaitlistJoinDeps {
	dbJoin: (
		email: string,
		referredBy: string | null | undefined,
		utmSource: string | null | undefined,
		useCase: string | null | undefined,
	) => Promise<{ spot: number; already_joined: boolean; member_id: number }>
	brevoSync: (payload: BrevoContactPayload) => Promise<void>
	outboxEnqueue: (waitlistId: number, payload: BrevoContactPayload) => Promise<void>
}

export interface WaitlistOutboxDeps {
	brevoSync: (payload: BrevoContactPayload) => Promise<void>
	listPendingBrevo: () => Promise<PendingBrevoRow[]>
	markBrevoSynced: (rowId: number) => Promise<void>
	recordBrevoFailure: (rowId: number, error: string) => Promise<void>
}

export interface WaitlistDeps extends WaitlistJoinDeps {
	listPendingBrevo?: () => Promise<PendingBrevoRow[]>
	markBrevoSynced?: (rowId: number) => Promise<void>
	recordBrevoFailure?: (rowId: number, error: string) => Promise<void>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail (email: string): boolean {
	return EMAIL_RE.test(email.trim())
}

const DB_LIMITS = { ref: 100, utm: 100, useCase: 500 } as const

function clamp (value: string | null | undefined, max: number): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed.slice(0, max) : undefined
}

function buildBrevoPayload (
	email: string,
	utmSource: string | undefined,
	useCase: string | undefined,
): BrevoContactPayload {
	return {
		email,
		updateEnabled: true,
		doubleOptin: true,
		attributes: {
			...(utmSource ? { UTM_SOURCE: utmSource } : {}),
			...(useCase ? { USECASE: useCase } : {}),
		},
	}
}

export async function joinWaitlist (
	deps: WaitlistJoinDeps,
	input: WaitlistJoinInput,
): Promise<WaitlistJoinResult> {
	const email = input.email.trim().toLowerCase()
	if (!validateEmail(email)) {
		throw new Error('Invalid email address')
	}

	const referredBy = clamp(input.ref, DB_LIMITS.ref)
	const utmSource = clamp(input.utmSource, DB_LIMITS.utm)
	const useCase = clamp(input.useCase, DB_LIMITS.useCase)

	const row = await deps.dbJoin(email, referredBy, utmSource, useCase)

	if (!row.already_joined) {
		const payload = buildBrevoPayload(email, utmSource, useCase)
		try {
			await deps.brevoSync(payload)
		} catch {
			// Brevo must never fail a signup (#85 AC). Queue for retry instead.
			await deps.outboxEnqueue(row.member_id, payload)
		}
	}

	return {
		position: row.spot,
		alreadyJoined: row.already_joined,
		foundingFull: row.spot > FOUNDING_COHORT_CAP,
	}
}

/**
 * Drains the Brevo outbox: re-sends pending contacts, marking successes and
 * recording failures. Called by the retry endpoint (cron-wired in #90).
 */
export async function retryBrevoOutbox (deps: WaitlistOutboxDeps): Promise<void> {
	const pending = await deps.listPendingBrevo()
	for (const row of pending) {
		try {
			await deps.brevoSync(row.payload)
			await deps.markBrevoSynced(row.id)
		} catch (error) {
			await deps.recordBrevoFailure(
				row.id,
				error instanceof Error ? error.message : String(error),
			)
		}
	}
}
