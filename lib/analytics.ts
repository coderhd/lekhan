'use client'

/**
 * The single analytics seam (#83): every product event goes through `track()`.
 * Pageviews are handled by the GA4 script config in google-analytics.tsx.
 *
 * Privacy rules (docs/analytics/event-taxonomy.md):
 * - Ids, counts, enum kinds only. Never note titles, content, or properties.
 * - Never call window.gtag directly outside this module.
 */

export const GA_MEASUREMENT_ID = 'G-4TP8GGDRFC'

export type AnalyticsProps = Record<string, string | number | boolean | undefined>

declare global {
	interface Window {
		dataLayer?: unknown[]
		gtag?: (...args: unknown[]) => void
	}
}

export function track (event: string, props: AnalyticsProps = {}): void {
	if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
	window.gtag('event', event, props)
}
