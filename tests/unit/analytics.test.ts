import { describe, it, expect, vi, beforeEach } from 'vitest'
import { track, GA_MEASUREMENT_ID } from '@/lib/analytics'

describe('analytics track seam', () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it('forwards events with props to the gtag queue', () => {
		const gtag = vi.fn()
		;(window as unknown as { gtag?: unknown }).gtag = gtag
		;(window as unknown as { dataLayer?: unknown[] }).dataLayer = []

		track('page_created', { is_first: true, count: 3 })
		expect(gtag).toHaveBeenCalledWith('event', 'page_created', { is_first: true, count: 3 })
	})

	it('is a no-op when the GA script has not loaded (no window.gtag)', () => {
		delete (window as unknown as { gtag?: unknown }).gtag
		expect(() => track('signup_completed')).not.toThrow()
	})

	it('is a no-op during server-side rendering (no window)', async () => {
		const mod = await import('@/lib/analytics')
		const originalWindow = globalThis.window
		// @ts-expect-error simulate SSR where window is undefined
		delete globalThis.window
		try {
			expect(() => mod.track('any_event')).not.toThrow()
		} finally {
			globalThis.window = originalWindow
		}
	})

	it('exposes the measurement id as the single source for script + config', () => {
		expect(GA_MEASUREMENT_ID).toMatch(/^G-[A-Z0-9]+$/)
	})
})
