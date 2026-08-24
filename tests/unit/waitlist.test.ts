import { describe, it, expect, vi } from 'vitest'
import {
	joinWaitlist,
	retryBrevoOutbox,
	validateEmail,
	FOUNDING_COHORT_CAP,
	type WaitlistJoinDeps,
	type WaitlistOutboxDeps,
} from '@/services/waitlist'

function makeDeps (
	overrides: Partial<WaitlistJoinDeps & WaitlistOutboxDeps> = {},
): WaitlistJoinDeps & WaitlistOutboxDeps {
	const dbJoin = vi.fn().mockResolvedValue({ spot: 37, already_joined: false, member_id: 1 })
	const brevoSync = vi.fn().mockResolvedValue(undefined)
	const outboxEnqueue = vi.fn().mockResolvedValue(undefined)
	const listPendingBrevo = vi.fn().mockResolvedValue([])
	const markBrevoSynced = vi.fn().mockResolvedValue(undefined)
	const recordBrevoFailure = vi.fn().mockResolvedValue(undefined)
	return {
		dbJoin,
		brevoSync,
		outboxEnqueue,
		listPendingBrevo,
		markBrevoSynced,
		recordBrevoFailure,
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
	it('joins a new member, syncs Brevo, writes no outbox row', async () => {
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
		expect(deps.brevoSync).toHaveBeenCalledTimes(1)
		expect(deps.brevoSync).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'reader@example.com', doubleOptin: true }),
		)
		expect(deps.outboxEnqueue).not.toHaveBeenCalled()
	})

	it('returns the existing position for a duplicate email and skips Brevo', async () => {
		const deps = makeDeps({
			dbJoin: vi.fn().mockResolvedValue({ spot: 12, already_joined: true, member_id: 9 }),
		})
		const result = await joinWaitlist(deps, { email: 'dupe@example.com' })

		expect(result).toEqual({ position: 12, alreadyJoined: true, foundingFull: false })
		expect(deps.brevoSync).not.toHaveBeenCalled()
		expect(deps.outboxEnqueue).not.toHaveBeenCalled()
	})

	it('marks positions beyond the founding cap as wave two but still stores + syncs them', async () => {
		const deps = makeDeps({
			dbJoin: vi.fn().mockResolvedValue({
				spot: FOUNDING_COHORT_CAP + 1,
				already_joined: false,
				member_id: 501,
			}),
		})
		const result = await joinWaitlist(deps, { email: 'wave2@example.com' })

		expect(result.foundingFull).toBe(true)
		expect(deps.brevoSync).toHaveBeenCalledTimes(1)
	})

	it('does not fail the signup when Brevo is down — queues an outbox row instead', async () => {
		const deps = makeDeps({
			brevoSync: vi.fn().mockRejectedValue(new Error('brevo 5xx')),
		})
		const result = await joinWaitlist(deps, { email: 'offline@example.com' })

		expect(result.position).toBe(37)
		expect(deps.outboxEnqueue).toHaveBeenCalledTimes(1)
		expect(deps.outboxEnqueue).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ email: 'offline@example.com' }),
		)
	})

	it('rejects invalid emails before touching the database or Brevo', async () => {
		const deps = makeDeps()
		await expect(joinWaitlist(deps, { email: 'garbage' })).rejects.toThrow()
		expect(deps.dbJoin).not.toHaveBeenCalled()
		expect(deps.brevoSync).not.toHaveBeenCalled()
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

describe('retryBrevoOutbox', () => {
	it('re-sends each pending payload and marks successes synced', async () => {
		const markSynced = vi.fn().mockResolvedValue(undefined)
		const deps = makeDeps({
			listPendingBrevo: vi
				.fn()
				.mockResolvedValue([
					{ id: 11, waitlistId: 1, payload: { email: 'a@example.com' } },
					{ id: 12, waitlistId: 2, payload: { email: 'b@example.com' } },
				]),
			markBrevoSynced: markSynced,
			recordBrevoFailure: vi.fn().mockResolvedValue(undefined),
		})

		await retryBrevoOutbox(deps)

		expect(deps.brevoSync).toHaveBeenCalledTimes(2)
		expect(markSynced).toHaveBeenCalledWith(11)
		expect(markSynced).toHaveBeenCalledWith(12)
	})

	it('records the failure and keeps the row pending when Brevo still rejects', async () => {
		const recordFailure = vi.fn().mockResolvedValue(undefined)
		const brevoSync = vi.fn().mockRejectedValue(new Error('still down'))
		const deps = makeDeps({
			brevoSync,
			listPendingBrevo: vi
				.fn()
				.mockResolvedValue([{ id: 21, waitlistId: 3, payload: { email: 'c@example.com' } }]),
			markBrevoSynced: vi.fn(),
			recordBrevoFailure: recordFailure,
		})

		await retryBrevoOutbox(deps)

		expect(recordFailure).toHaveBeenCalledWith(21, expect.stringContaining('still down'))
	})
})
