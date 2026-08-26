import { describe, it, expect, vi, beforeEach } from 'vitest'
import posthog from 'posthog-js'
import {
	track,
	initAnalytics,
	identifyUser,
	resetAnalytics,
	isFeatureEnabled,
	_resetStateForTesting,
	sanitizeProps,
	GA_MEASUREMENT_ID,
	POSTHOG_EU_HOST,
} from '@/lib/analytics'

vi.mock('posthog-js', () => ({
	default: {
		init: vi.fn(),
		capture: vi.fn(),
		identify: vi.fn(),
		reset: vi.fn(),
		isFeatureEnabled: vi.fn(),
	},
}))

describe('analytics module', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		_resetStateForTesting()
		delete (window as unknown as { gtag?: unknown }).gtag
	})

	describe('initAnalytics', () => {
		it('initializes posthog with EU host and strict privacy flags when key is present', () => {
			initAnalytics('test-posthog-key', 'https://eu.i.posthog.com')

			expect(posthog.init).toHaveBeenCalledWith(
				'test-posthog-key',
				expect.objectContaining({
					api_host: 'https://eu.i.posthog.com',
					autocapture: false,
					disable_session_recording: true,
					capture_pageview: false,
				})
			)
		})

		it('defaults to POSTHOG_EU_HOST if no custom host provided', () => {
			expect(POSTHOG_EU_HOST).toBe('https://eu.i.posthog.com')
			initAnalytics('test-key')
			expect(posthog.init).toHaveBeenCalledWith(
				'test-key',
				expect.objectContaining({
					api_host: 'https://eu.i.posthog.com',
				})
			)
		})

		it('does not initialize posthog if no key is provided', () => {
			initAnalytics(undefined)
			expect(posthog.init).not.toHaveBeenCalled()
		})
	})

	describe('track seam & sanitizeProps', () => {
		it('fans out events with props to both gtag and posthog', () => {
			const gtag = vi.fn()
			;(window as unknown as { gtag?: unknown }).gtag = gtag

			track('page_created', { is_first: true, count: 3 })

			expect(gtag).toHaveBeenCalledWith('event', 'page_created', { is_first: true, count: 3 })
			expect(posthog.capture).toHaveBeenCalledWith('page_created', { is_first: true, count: 3 })
		})

		it('strips forbidden content keys and aliased keys to enforce privacy invariant', () => {
			const gtag = vi.fn()
			;(window as unknown as { gtag?: unknown }).gtag = gtag

			track('page_created', {
				is_first: true,
				title: 'Secret Note Title',
				noteTitle: 'Alias Title',
				page_content: 'Private document text',
				custom_body: 'Private body',
				markdown_text: '### md',
				plaintext: 'Private document text',
			} as any)

			expect(gtag).toHaveBeenCalledWith('event', 'page_created', { is_first: true })
			expect(posthog.capture).toHaveBeenCalledWith('page_created', { is_first: true })
		})

		it('drops non-allowlisted properties for supported events', () => {
			const sanitized = sanitizeProps('page_created', {
				is_first: true,
				count: 5,
				unauthorized_extra_prop: 'some value',
			} as any)

			expect(sanitized).toEqual({ is_first: true, count: 5 })
		})

		it('returns empty props for unsupported event names', () => {
			const sanitized = sanitizeProps('arbitrary_unsupported_event', {
				some_prop: 'val',
			})
			expect(sanitized).toEqual({})
		})

		it('is safe when gtag or posthog fail or are not available', () => {
			expect(() => track('signup_completed')).not.toThrow()
		})
	})

	describe('identifyUser & resetAnalytics', () => {
		it('identifies user in posthog with only allowed identity traits', () => {
			identifyUser('user-123', {
				email: 'user@example.com',
				plan: 'pro',
				disallowed_secret: 'secret_value',
				token: 'token_123',
			})
			expect(posthog.identify).toHaveBeenCalledWith('user-123', {
				email: 'user@example.com',
				plan: 'pro',
			})
		})

		it('resets analytics on logout', () => {
			resetAnalytics()
			expect(posthog.reset).toHaveBeenCalled()
		})
	})

	describe('isFeatureEnabled', () => {
		it('returns posthog feature flag value if present', () => {
			vi.mocked(posthog.isFeatureEnabled).mockReturnValue(true)
			expect(isFeatureEnabled('history-retention-gate', false)).toBe(true)
		})

		it('falls back to default value when posthog returns undefined/boolean', () => {
			vi.mocked(posthog.isFeatureEnabled).mockReturnValue(undefined)
			expect(isFeatureEnabled('tier-sync-gate', false)).toBe(false)
			expect(isFeatureEnabled('tier-sync-gate', true)).toBe(true)
		})
	})

	describe('GA_MEASUREMENT_ID', () => {
		it('exposes the measurement id as the single source for script + config', () => {
			expect(GA_MEASUREMENT_ID).toMatch(/^G-[A-Z0-9]+$/)
		})
	})
})
