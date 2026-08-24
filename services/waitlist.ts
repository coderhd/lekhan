/**
 * Founding-cohort waitlist domain logic (#85).
 *
 * The database owns the hard invariants (unique email, monotonic spot numbers,
 * the 500 cap being soft, confirm-token minting) via the `join_waitlist` and
 * `confirm_waitlist` RPCs; this module owns input hygiene, the Brevo contract,
 * the confirmation email, and the guarantee that neither Brevo nor SMTP
 * outages ever fail a signup (outbox rows instead).
 *
 * Double opt-in is self-hosted (option B): we email the confirm link over
 * Brevo's transactional API ourselves — Brevo-native DOU proved opaque.
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

export interface ConfirmEmailPayload {
	email: string
	token: string
	position?: number
}

export type OutboxKind = 'contact_sync' | 'confirm_email'

export interface PendingBrevoRow {
	id: number
	waitlistId: number
	kind: OutboxKind
	payload: BrevoContactPayload | ConfirmEmailPayload
}

export interface WaitlistJoinDeps {
	dbJoin: (
		email: string,
		referredBy: string | null | undefined,
		utmSource: string | null | undefined,
		useCase: string | null | undefined,
	) => Promise<{ spot: number; already_joined: boolean; member_id: number; token: string | null }>
	brevoSync: (payload: BrevoContactPayload) => Promise<void>
	emailSender: (payload: ConfirmEmailPayload) => Promise<void>
	outboxEnqueue: (waitlistId: number, kind: OutboxKind, payload: BrevoContactPayload | ConfirmEmailPayload) => Promise<void>
}

export interface WaitlistOutboxDeps {
	brevoSync: (payload: BrevoContactPayload) => Promise<void>
	emailSender: (payload: ConfirmEmailPayload) => Promise<void>
	listPendingBrevo: () => Promise<PendingBrevoRow[]>
	markBrevoSynced: (rowId: number) => Promise<void>
	recordBrevoFailure: (rowId: number, error: string) => Promise<void>
}

export interface WaitlistDeps extends WaitlistJoinDeps {
	listPendingBrevo?: () => Promise<PendingBrevoRow[]>
	markBrevoSynced?: (rowId: number) => Promise<void>
	recordBrevoFailure?: (rowId: number, error: string) => Promise<void>
	dbConfirm?: (token: string) => Promise<{ spot: number; email: string } | null>
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
		// Brevo-native DOU is replaced by our own confirmation email (#85 option B).
		doubleOptin: false,
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
		// Confirmation email first: it is the member's call to action. Failure
		// must never fail the signup (#85 AC) — queue for the retry drain.
		if (row.token) {
			const emailPayload: ConfirmEmailPayload = {
				email,
				token: row.token,
				position: row.spot,
			}
			try {
				await deps.emailSender(emailPayload)
			} catch {
				await deps.outboxEnqueue(row.member_id, 'confirm_email', emailPayload)
			}
		}

		const contactPayload = buildBrevoPayload(email, utmSource, useCase)
		try {
			await deps.brevoSync(contactPayload)
		} catch {
			await deps.outboxEnqueue(row.member_id, 'contact_sync', contactPayload)
		}
	}

	return {
		position: row.spot,
		alreadyJoined: row.already_joined,
		foundingFull: row.spot > FOUNDING_COHORT_CAP,
	}
}

export interface ConfirmResult {
	position?: number
	email?: string
	alreadyConfirmed: boolean
}

export async function confirmByToken (
	deps: { dbConfirm: (token: string) => Promise<{ spot: number; email: string } | null> },
	token: string,
): Promise<ConfirmResult> {
	const trimmed = token.trim()
	if (!trimmed) {
		throw new Error('Missing confirmation token')
	}

	const row = await deps.dbConfirm(trimmed)
	if (!row) {
		// Unknown or already-used token — idempotent, friendly, no enumeration.
		return { alreadyConfirmed: true }
	}

	return { position: row.spot, email: row.email, alreadyConfirmed: false }
}

/**
 * Drains the outbox: re-sends pending contact syncs and confirmation emails,
 * marking successes and recording failures. Called by the retry endpoint
 * (cron-wired in #90).
 */
export async function retryBrevoOutbox (deps: WaitlistOutboxDeps): Promise<void> {
	const pending = await deps.listPendingBrevo()
	for (const row of pending) {
		try {
			if (row.kind === 'confirm_email') {
				await deps.emailSender(row.payload as ConfirmEmailPayload)
			} else {
				await deps.brevoSync(row.payload as BrevoContactPayload)
			}
			await deps.markBrevoSynced(row.id)
		} catch (error) {
			await deps.recordBrevoFailure(
				row.id,
				error instanceof Error ? error.message : String(error),
			)
		}
	}
}
