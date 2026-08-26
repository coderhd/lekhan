'use client'

import posthog from 'posthog-js'

/**
 * The single analytics seam (#83): every product event goes through `track()`.
 * Fans out to both GA4 (for acquisition/marketing) and PostHog (for product
 * funnels & feature flags).
 *
 * Privacy rules (docs/analytics/event-taxonomy.md):
 * - Ids, counts, enum kinds only. Never note titles, content, or properties.
 * - Never call window.gtag or posthog directly outside this module.
 */

export const GA_MEASUREMENT_ID = 'G-4TP8GGDRFC'
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'

const FORBIDDEN_PROPERTY_KEYS = new Set([
	'title',
	'content',
	'plaintext',
	'body',
	'properties',
	'markdown',
])

export type AnalyticsProps = Record<
	string,
	string | number | boolean | undefined | null
>

declare global {
	interface Window {
		dataLayer?: unknown[]
		gtag?: (...args: unknown[]) => void
	}
}

let isPostHogInitialized = false

/**
 * Reset internal init state (for test isolation only).
 */
export function _resetStateForTesting(): void {
	isPostHogInitialized = false
}

/**
 * Sanitize event properties to enforce the privacy invariant:
 * Under no circumstances do note titles, bodies, or properties leave client.
 */
function sanitizeProps(props: AnalyticsProps): AnalyticsProps {
	const sanitized: AnalyticsProps = {}
	for (const [key, val] of Object.entries(props)) {
		if (!FORBIDDEN_PROPERTY_KEYS.has(key.toLowerCase()) && val !== undefined) {
			sanitized[key] = val
		}
	}
	return sanitized
}

/**
 * Initialize analytics destinations. PostHog EU cloud by default with strict
 * privacy settings (autocapture OFF, session recording OFF).
 */
export function initAnalytics(
	apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY,
	host = process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_EU_HOST,
): void {
	if (typeof window === 'undefined' || !apiKey) {
		return
	}

	if (!isPostHogInitialized) {
		posthog.init(apiKey, {
			api_host: host,
			autocapture: false,
			capture_pageview: false,
			disable_session_recording: true,
			persistence: 'localStorage+cookie',
		})
		isPostHogInitialized = true
	}
}

/**
 * Single tracking entrypoint for all product events.
 */
export function track(event: string, props: AnalyticsProps = {}): void {
	if (typeof window === 'undefined') return

	const safeProps = sanitizeProps(props)

	// 1. Forward to Google Analytics 4 (if loaded)
	if (typeof window.gtag === 'function') {
		try {
			window.gtag('event', event, safeProps)
		} catch (err) {
			console.warn('[Analytics] GA4 event dispatch error:', err)
		}
	}

	// 2. Forward to PostHog (if initialized)
	try {
		posthog.capture(event, safeProps)
	} catch (err) {
		console.warn('[Analytics] PostHog event dispatch error:', err)
	}
}

/**
 * Associate a user with analytics upon login / session establishment.
 */
export function identifyUser(
	userId: string,
	traits?: Record<string, string | number | boolean>,
): void {
	if (typeof window === 'undefined') return

	try {
		posthog.identify(userId, traits)
	} catch (err) {
		console.warn('[Analytics] PostHog identify error:', err)
	}
}

/**
 * Reset analytics state upon logout.
 */
export function resetAnalytics(): void {
	if (typeof window === 'undefined') return

	try {
		posthog.reset()
	} catch (err) {
		console.warn('[Analytics] PostHog reset error:', err)
	}
}

/**
 * Feature flag evaluation with safe fallback (for #82 tier gates).
 */
export function isFeatureEnabled(
	flagKey: string,
	defaultValue = false,
): boolean {
	if (typeof window === 'undefined') return defaultValue

	try {
		const result = posthog.isFeatureEnabled(flagKey)
		return typeof result === 'boolean' ? result : defaultValue
	} catch {
		return defaultValue
	}
}
