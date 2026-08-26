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

/**
 * Forbidden substrings in property names to guarantee note data cannot leak.
 */
const FORBIDDEN_PROPERTY_SUBSTRINGS = [
	'title',
	'content',
	'plaintext',
	'body',
	'properties',
	'markdown',
]

export interface EventPayloadMap {
	signup_started: { method?: string }
	signup_completed: { method?: string }
	login_completed: { method?: string }
	workspace_created: Record<string, never> | void
	page_created: { is_first?: boolean; count?: number }
	page_deleted: { remaining_count?: number }
	link_created: Record<string, never> | void
	import_completed: {
		source: 'obsidian' | 'markdown' | string
		pages_count?: number
		folder_pages_count?: number
	}
	import_report_viewed: {
		pages?: number
		folder_pages?: number
		links_resolved?: number
		links_unresolved?: number
		degraded_blocks?: number
		warnings_count?: number
	}
	paste_in_resolved: { kind: 'markdown' | 'codeBlock' | string }
	copy_out_used: Record<string, never> | void
	export_triggered: { format: 'markdown' | 'mdx' | 'html' | 'docx' | 'pdf' | string }
	paywall_hit: { gate: 'collaborators' | 'history' | string }
	upgrade_clicked: {
		plan: string
		billing_cycle?: 'yearly' | 'monthly' | string
	}
	ai_provider_connected: { kind: 'byok' | 'byol' | 'preset' | string }
	ai_message_sent: { action?: string }
	daily_active_edit: Record<string, never> | void
}

export type EventName = keyof EventPayloadMap

/**
 * Closed allowlist of permitted property keys per event.
 */
const EVENT_ALLOWED_KEYS: Record<EventName, Set<string>> = {
	signup_started: new Set(['method']),
	signup_completed: new Set(['method']),
	login_completed: new Set(['method']),
	workspace_created: new Set([]),
	page_created: new Set(['is_first', 'count']),
	page_deleted: new Set(['remaining_count']),
	link_created: new Set([]),
	import_completed: new Set(['source', 'pages_count', 'folder_pages_count']),
	import_report_viewed: new Set([
		'pages',
		'folder_pages',
		'links_resolved',
		'links_unresolved',
		'degraded_blocks',
		'warnings_count',
	]),
	paste_in_resolved: new Set(['kind']),
	copy_out_used: new Set([]),
	export_triggered: new Set(['format']),
	paywall_hit: new Set(['gate']),
	upgrade_clicked: new Set(['plan', 'billing_cycle']),
	ai_provider_connected: new Set(['kind']),
	ai_message_sent: new Set(['action']),
	daily_active_edit: new Set([]),
}

/**
 * Closed allowlist of allowed user identity traits.
 */
const ALLOWED_IDENTITY_TRAITS = new Set([
	'email',
	'created_at',
	'plan',
	'tier',
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
 * Sanitize event properties to enforce the closed schema and privacy invariant:
 * - Drops any keys not explicitly in the event's allowlist
 * - Drops any keys matching forbidden substrings (e.g. noteTitle, page_content)
 */
export function sanitizeProps(eventName: string, props: AnalyticsProps): AnalyticsProps {
	const allowedKeys = EVENT_ALLOWED_KEYS[eventName as EventName]
	if (!allowedKeys) {
		return {}
	}

	const sanitized: AnalyticsProps = {}
	for (const [key, val] of Object.entries(props)) {
		if (val === undefined) continue

		const lowerKey = key.toLowerCase()
		const hasForbiddenSubstring = FORBIDDEN_PROPERTY_SUBSTRINGS.some(sub =>
			lowerKey.includes(sub)
		)

		if (hasForbiddenSubstring) continue

		if (allowedKeys.has(key)) {
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
export function track<E extends EventName>(
	event: E,
	props?: EventPayloadMap[E],
): void
export function track(event: string, props?: AnalyticsProps): void
export function track(event: string, props: AnalyticsProps = {}): void {
	if (typeof window === 'undefined') return

	const safeProps = sanitizeProps(event, props)

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
 * Filters traits through an explicit identity-trait allowlist.
 */
export function identifyUser(
	userId: string,
	traits?: Record<string, string | number | boolean>,
): void {
	if (typeof window === 'undefined') return

	const filteredTraits: Record<string, string | number | boolean> = {}
	if (traits) {
		for (const [key, val] of Object.entries(traits)) {
			if (ALLOWED_IDENTITY_TRAITS.has(key) && val !== undefined) {
				filteredTraits[key] = val
			}
		}
	}

	try {
		posthog.identify(userId, filteredTraits)
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
