import { describe, it, expect, vi } from 'vitest'
import {
	joinWaitlist,
	confirmByToken,
	retryBrevoOutbox,
	validateEmail,
	FOUNDING_COHORT_CAP,
	type WaitlistJoinDeps,
	type WaitlistOutboxDeps,
} from '@/services/waitlist'

type DbConfirm = (token: string) => Promise<{ spot: number; email: string } | null>
type AllDeps = WaitlistJoinDeps & WaitlistOutboxDeps & { dbConfirm: DbConfirm }

function makeDeps (overrides: Partial<AllDeps> = {}): AllDeps {
	const dbJoin = vi.fn().mockResolvedValue({
		spot: 37,
		already_joined: false,
		member_id: 1,
		token: 'tok-abc-123',
	})
	const brevoSync = vi.fn().mockResolvedValue(undefined)
	const emailSender = vi.fn().mockResolvedValue(undefined)
	const outboxEnqueue = vi.fn().mockResolvedValue(undefined)
	const listPendingBrevo = vi.fn().mockResolvedValue([])
	const markBrevoSynced = vi.fn().mockResolvedValue(undefined)
	const recordBrevoFailure = vi.fn().mockResolvedValue(undefined)
	const dbConfirm = vi.fn().mockResolvedValue({ spot: 37, email: 'reader@example.com' })
	return {
		dbJoin,
		brevoSync,
		emailSender,
		outboxEnqueue,
		listPendingBrevo,
		markBrevoSynced,
		recordBrevoFailure,
		dbConfirm,
		...overrides,
	}
}

describe('validateEmail', () => {
	it('accepts a normal address', () => {
		expect(validateEmail('reader@example.com')).toBe(true)
	})

	it('rejects empty and obvious garbage', () => {
		expect(validateEmail('')).toBe(false)
		expect(validateEmail('not-an-email')).toBe(false)
		expect(validateEmail('a@b')).toBe(false)
	})
})

describe('joinWaitlist', () => {
	it('joins a new member, sends the confirmation email, syncs Brevo without native DOU', async () => {
		const deps = makeDeps()
		const result = await joinWaitlist(deps, {
			email: 'reader@example.com',
			ref: 'linkedin',
			utmSource: 'linkedin',
			useCase: 'team wiki on my own files',
		})

		expect(result).toEqual({ position: 37, alreadyJoined: false, foundingFull: false })
		expect(deps.dbJoin).toHaveBeenCalledWith(
			'reader@example.com',
			'linkedin',
			'linkedin',
			'team wiki on my own files',
		)
		// Confirmation email carries the token; the token never leaves the backend otherwise.
		expect(deps.emailSender).toHaveBeenCalledTimes(1)
		expect(deps.emailSender).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'reader@example.com', token: 'tok-abc-123' }),
		)
		// Brevo-native double opt-in is replaced by our own email (#85 option B).
		expect(deps.brevoSync).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'reader@example.com', doubleOptin: false }),
		)
		expect(deps.outboxEnqueue).not.toHaveBeenCalled()
	})

	it('returns the existing position for a duplicate email and sends nothing', async () => {
		const deps = makeDeps({
			dbJoin: vi.fn().mockResolvedValue({
				spot: 12,
				already_joined: true,
				member_id: 9,
				token: null,
			}),
		})
		const result = await joinWaitlist(deps, { email: 'dupe@example.com' })

		expect(result).toEqual({ position: 12, alreadyJoined: true, foundingFull: false })
		expect(deps.emailSender).not.toHaveBeenCalled()
		expect(deps.brevoSync).not.toHaveBeenCalled()
		expect(deps.outboxEnqueue).not.toHaveBeenCalled()
	})

	it('marks positions beyond the founding cap as wave two but still stores + emails them', async () => {
		const deps = makeDeps({
			dbJoin: vi.fn().mockResolvedValue({
				spot: FOUNDING_COHORT_CAP + 1,
				already_joined: false,
				member_id: 501,
				token: 'tok-wave2',
			}),
		})
		const result = await joinWaitlist(deps, { email: 'wave2@example.com' })

		expect(result.foundingFull).toBe(true)
		expect(deps.emailSender).toHaveBeenCalledTimes(1)
	})

	it('does not fail the signup when the confirmation email fails — queues it instead', async () => {
		const deps = makeDeps({
			emailSender: vi.fn().mockRejectedValue(new Error('smtp 5xx')),
		})
		const result = await joinWaitlist(deps, { email: 'offline@example.com' })

		expect(result.position).toBe(37)
		expect(deps.outboxEnqueue).toHaveBeenCalledTimes(1)
		expect(deps.outboxEnqueue).toHaveBeenCalledWith(
			1,
			'confirm_email',
			expect.objectContaining({ email: 'offline@example.com', token: 'tok-abc-123' }),
		)
	})

	it('does not fail the signup when Brevo contact sync fails either', async () => {
		const deps = makeDeps({
			brevoSync: vi.fn().mockRejectedValue(new Error('brevo 5xx')),
		})
		const result = await joinWaitlist(deps, { email: 'brevodown@example.com' })

		expect(result.position).toBe(37)
		expect(deps.outboxEnqueue).toHaveBeenCalledWith(
			1,
			'contact_sync',
			expect.objectContaining({ email: 'brevodown@example.com' }),
		)
	})

	it('rejects invalid emails before touching the database or email', async () => {
		const deps = makeDeps()
		await expect(joinWaitlist(deps, { email: 'garbage' })).rejects.toThrow()
		expect(deps.dbJoin).not.toHaveBeenCalled()
		expect(deps.emailSender).not.toHaveBeenCalled()
	})

	it('trims whitespace around the email', async () => {
		const deps = makeDeps()
		await joinWaitlist(deps, { email: '  padded@example.com  ' })
		expect(deps.dbJoin).toHaveBeenCalledWith('padded@example.com', undefined, undefined, undefined)
	})

	it('caps stored field lengths at the database limits', async () => {
		const deps = makeDeps()
		await joinWaitlist(deps, {
			email: 'x@example.com',
			useCase: 'u'.repeat(600),
		})
		expect(deps.dbJoin).toHaveBeenCalledWith('x@example.com', undefined, undefined, 'u'.repeat(500))
	})
})

describe('confirmByToken', () => {
	it('confirms a member and returns their spot + email', async () => {
		const deps = makeDeps()
		const result = await confirmByToken(deps, 'tok-abc-123')

		expect(deps.dbConfirm).toHaveBeenCalledWith('tok-abc-123')
		expect(result).toEqual({ position: 37, email: 'reader@example.com', alreadyConfirmed: false })
	})

	it('reports already-confirmed when the token was already used', async () => {
		const deps = makeDeps({
			dbConfirm: vi.fn().mockResolvedValue(null),
		})
		const result = await confirmByToken(deps, 'tok-used')

		expect(result).toEqual({ alreadyConfirmed: true })
	})

	it('rejects empty tokens without hitting the database', async () => {
		const deps = makeDeps()
		await expect(confirmByToken(deps, '')).rejects.toThrow()
		expect(deps.dbConfirm).not.toHaveBeenCalled()
	})
})

describe('retryBrevoOutbox', () => {
	it('re-sends each pending payload and marks successes synced', async () => {
		const markSynced = vi.fn().mockResolvedValue(undefined)
		const deps = makeDeps({
			listPendingBrevo: vi.fn().mockResolvedValue([
				{ id: 11, waitlistId: 1, kind: 'contact_sync', payload: { email: 'a@example.com' } },
				{ id: 12, waitlistId: 2, kind: 'contact_sync', payload: { email: 'b@example.com' } },
			]),
			markBrevoSynced: markSynced,
		})

		await retryBrevoOutbox(deps)

		expect(deps.brevoSync).toHaveBeenCalledTimes(2)
		expect(markSynced).toHaveBeenCalledWith(11)
		expect(markSynced).toHaveBeenCalledWith(12)
	})

	it('re-sends queued confirmation emails through the email sender', async () => {
		const deps = makeDeps({
			listPendingBrevo: vi.fn().mockResolvedValue([
				{
					id: 13,
					waitlistId: 3,
					kind: 'confirm_email',
					payload: { email: 'c@example.com', token: 'tok-queued' },
				},
			]),
		})

		await retryBrevoOutbox(deps)

		expect(deps.emailSender).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'c@example.com', token: 'tok-queued' }),
		)
		expect(deps.markBrevoSynced).toHaveBeenCalledWith(13)
	})

	it('records the failure and keeps the row pending when the sender still rejects', async () => {
		const recordFailure = vi.fn().mockResolvedValue(undefined)
		const brevoSync = vi.fn().mockRejectedValue(new Error('still down'))
		const deps = makeDeps({
			brevoSync,
			listPendingBrevo: vi.fn().mockResolvedValue([
				{ id: 21, waitlistId: 3, kind: 'contact_sync', payload: { email: 'c@example.com' } },
			]),
			recordBrevoFailure: recordFailure,
		})

		await retryBrevoOutbox(deps)

		expect(recordFailure).toHaveBeenCalledWith(21, expect.stringContaining('still down'))
	})
})
