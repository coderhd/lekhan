/**
 * T7 — Razorpay rail (India / INR), server-only.
 *
 * Thin REST wrapper over `https://api.razorpay.com/v1` using `fetch` + HTTP Basic
 * auth (PDEC-8: no Razorpay SDK, no webhook dependency). Subscriptions Standard is
 * fully hosted (PDEC-1): `createCheckout` creates a Subscription server-side and
 * returns `subscription.short_url` for the owner to be redirected to. There is no
 * `checkout.js` and no `NEXT_PUBLIC_RAZORPAY_KEY_ID`, so PCI stays SAQ-A.
 *
 * Every price/plan identifier is resolved server-side from env bindings through
 * `lib/billing/prices.ts`; no request body ever carries a client-declared price,
 * tier or cohort (spec §13 "Never").
 *
 * Plan change (PDEC-12 / TL B1) rides the provider-native scheduled-change APIs and
 * is pinned to period-end (D5) semantics:
 *   PATCH /v1/subscriptions/:id                      (schedule_change_at: cycle_end)
 *   GET   /v1/subscriptions/:id/retrieve_scheduled_changes
 *   POST  /v1/subscriptions/:id/cancel_scheduled_changes
 * There is no Razorpay Billing-Portal equivalent: `portalUrl` returns the hosted
 * card-update payment-page link and never fabricates a portal session (TL R-1).
 *
 * Credentials are read lazily on each call, so importing this module never
 * requires secrets and every network path fails closed when they are absent.
 */

import {
	UnsupportedCurrencyError,
	assertSellableCheckout,
	type BillingTier,
	type CheckoutRequest,
	type CheckoutSession,
	type GatewaySubscriptionState,
	type GatewaySubscriptionStatus,
	type PaymentGateway,
	type PortalSession,
	type Rail,
	type SchedulePlanChangeRequest,
	type SchedulePlanChangeResult,
} from "./gateway"
import {
	resolvePriceRequest,
	type BillingCycle,
	type PriceCohort,
} from "./prices"

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1"

/**
 * Razorpay requires a bounded cycle count (`total_count`) or an end date. The
 * provider supports a maximum 100-year duration, so we set the maximum horizon
 * per cycle; the subscription renews until the owner cancels and the provider
 * remains the sole renewer (spec §6). Annual plans bill once per year.
 */
export const RAZORPAY_TOTAL_COUNT: Record<BillingCycle, number> = {
	monthly: 1200,
	annual: 100,
}

/** Missing/invalid server-side Razorpay configuration. Fails closed. */
export class RazorpayConfigError extends Error {
	readonly code = "razorpay_config"
	constructor(message: string) {
		super(message)
		this.name = "RazorpayConfigError"
	}
}

/** A non-2xx response from the Razorpay API. */
export class RazorpayApiError extends Error {
	readonly code = "razorpay_api"
	constructor(
		readonly status: number,
		readonly providerCode: string | undefined,
		readonly description: string | undefined,
		message?: string,
	) {
		super(
			message ??
				`Razorpay API error (${status})${providerCode ? ` ${providerCode}` : ""}: ${description ?? "unknown error"}`,
		)
		this.name = "RazorpayApiError"
	}
}

export type RazorpayHttpMethod = "GET" | "POST" | "PATCH"

export interface RazorpayHttpRequest {
	method: RazorpayHttpMethod
	path: string
	body?: unknown
}

/** Adapter seam: tests inject a recording client; production uses `fetch`. */
export interface RazorpayHttpClient {
	request<T>(req: RazorpayHttpRequest): Promise<T>
}

/** Razorpay subscription object (only the fields this rail reads are modelled). */
export interface RazorpaySubscription {
	id?: string
	status?: string
	plan_id?: string
	short_url?: string | null
	customer_id?: string | null
	current_end?: number | null
	change_scheduled_at?: number | null
	has_scheduled_changes?: boolean
	cancel_at_cycle_end?: boolean
	quantity?: number
	notes?: Record<string, string> | null
}

export interface RazorpayGatewayOptions {
	http?: RazorpayHttpClient
}

/** The Razorpay rail, including the scheduled-change surface beyond the shared contract. */
export interface RazorpayGateway extends PaymentGateway {
	retrieveScheduledChange(subscriptionRef: string): Promise<SchedulePlanChangeResult | null>
	cancelScheduledChange(subscriptionRef: string): Promise<void>
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]
	if (typeof value !== "string" || value.trim() === "") {
		throw new RazorpayConfigError(`Missing server-side Razorpay configuration: ${key} must be set.`)
	}
	return value
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return {}
	}
}

/**
 * Default HTTP client: `fetch` + HTTP Basic auth. Reads credentials lazily so a
 * missing key throws `RazorpayConfigError` before any network call.
 */
export function createRazorpayHttpClient(env: NodeJS.ProcessEnv = process.env): RazorpayHttpClient {
	return {
		async request<T>({ method, path, body }: RazorpayHttpRequest): Promise<T> {
			const keyId = requireEnv(env, "RAZORPAY_KEY_ID")
			const keySecret = requireEnv(env, "RAZORPAY_KEY_SECRET")
			const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`

			const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
				method,
				headers: { authorization, "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			})
			const text = await response.text()
			const parsed = text ? safeParse(text) : {}

			if (!response.ok) {
				const errorBody = (parsed as { error?: { code?: string; description?: string } }).error
				throw new RazorpayApiError(response.status, errorBody?.code, errorBody?.description)
			}
			return parsed as T
		},
	}
}

const STATUS_MAP: Record<string, GatewaySubscriptionStatus> = {
	active: "active",
	authenticated: "active",
	pending: "past_due",
	halted: "past_due",
	cancelled: "canceled",
	completed: "canceled",
	expired: "canceled",
	created: "incomplete",
}

/**
 * Unknown states fail closed as `active` so the single-live-subscription invariant
 * blocks a possible double charge rather than silently allowing a second checkout.
 */
function mapStatus(status: string | undefined): GatewaySubscriptionStatus {
	if (status && Object.prototype.hasOwnProperty.call(STATUS_MAP, status)) {
		return STATUS_MAP[status]
	}
	console.warn(`[billing/razorpay] unrecognised subscription status "${String(status)}"; treating as active`)
	return "active"
}

function unixToIso(seconds: number | null | undefined): string | null {
	return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
}

const PLAN_KEY_PATTERN = /^RAZORPAY_PLAN_(PLUS|PRO|TEAM)_(MONTHLY|ANNUAL)_(FOUNDING|GA)_INR$/

interface IdentifiedPlan {
	tier: BillingTier
	cycle: BillingCycle
	cohort: PriceCohort
}

/** Reverse-map a provider `plan_id` to its tier/cycle/cohort via env bindings. */
function identifyPlan(planId: string, env: NodeJS.ProcessEnv): IdentifiedPlan | null {
	for (const [key, value] of Object.entries(env)) {
		if (value !== planId) continue
		const match = PLAN_KEY_PATTERN.exec(key)
		if (!match) continue
		return {
			tier: match[1].toLowerCase() as BillingTier,
			cycle: match[2].toLowerCase() as BillingCycle,
			cohort: match[3].toLowerCase() as PriceCohort,
		}
	}
	return null
}

/** Resolve the plan id for a target tier/cycle/cohort from server env only. */
function resolvePlanId(
	tier: BillingTier,
	cycle: BillingCycle,
	isFounding: boolean,
	env: NodeJS.ProcessEnv,
): string {
	const resolution = resolvePriceRequest(tier, cycle, "INR", isFounding)
	if (resolution.currency !== "INR") {
		throw new RazorpayConfigError(`Expected an INR plan binding, received "${resolution.currency}".`)
	}
	return requireEnv(env, resolution.planEnvKey)
}

function effectiveAtFor(subscription: RazorpaySubscription): string {
	const effectiveAt = unixToIso(subscription.change_scheduled_at ?? subscription.current_end)
	if (!effectiveAt) {
		throw new RazorpayApiError(
			200,
			undefined,
			undefined,
			"Razorpay did not report an effective time for the scheduled change.",
		)
	}
	return effectiveAt
}

/** Razorpay returns no change identifier, so a stable provider-derived ref is composed. */
function scheduledChangeRef(subscriptionRef: string, subscription: RazorpaySubscription): string {
	return `${subscriptionRef}:${subscription.change_scheduled_at ?? subscription.current_end}`
}

export function createRazorpayGateway(options: RazorpayGatewayOptions = {}): RazorpayGateway {
	const http = options.http ?? createRazorpayHttpClient()

	return {
		rail: "razorpay" as Rail,

		async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
			// Team is USD-only at H0; reject before touching the provider.
			assertSellableCheckout(req)
			if (req.currency !== "INR") {
				throw new UnsupportedCurrencyError(req.currency)
			}

			const planId = resolvePlanId(req.tier, req.cycle, req.isFounding, process.env)
			const subscription = await http.request<RazorpaySubscription>({
				method: "POST",
				path: "/subscriptions",
				body: {
					plan_id: planId,
					total_count: RAZORPAY_TOTAL_COUNT[req.cycle],
					// INR tiers are single-seat (Team is USD-only), so quantity is always 1.
					quantity: 1,
					customer_notify: true,
					notes: {
						workspace_id: req.workspaceId,
						tier: req.tier,
						cycle: req.cycle,
						is_founding: String(req.isFounding),
					},
				},
			})

			if (!subscription.id || !subscription.short_url) {
				throw new RazorpayApiError(
					200,
					undefined,
					undefined,
					"Razorpay subscription response is missing id/short_url.",
				)
			}

			return { checkoutUrl: subscription.short_url, opaqueRef: subscription.id }
		},

		async portalUrl(hostedPaymentPageUrl: string): Promise<PortalSession> {
			// PDEC-1 / TL R-1: no portal session. The card-update path is the
			// subscription's hosted payment-page link, returned as-is (no provider call).
			if (typeof hostedPaymentPageUrl !== "string" || hostedPaymentPageUrl.trim() === "") {
				throw new RazorpayConfigError("A hosted Razorpay payment-page link is required for card updates.")
			}
			return { url: hostedPaymentPageUrl, kind: "card_update" }
		},

		async cancelAtPeriodEnd(subscriptionRef: string): Promise<void> {
			await http.request<RazorpaySubscription>({
				method: "POST",
				path: `/subscriptions/${encodeURIComponent(subscriptionRef)}/cancel`,
				body: { cancel_at_cycle_end: true },
			})
		},

		async schedulePlanChange(req: SchedulePlanChangeRequest): Promise<SchedulePlanChangeResult> {
			// Cohort is not on the frozen shared request, so it is inferred from the
			// live subscription's current plan (server truth) rather than assumed GA —
			// a founding workspace must never be silently re-priced to GA.
			const current = await http.request<RazorpaySubscription>({
				method: "GET",
				path: `/subscriptions/${encodeURIComponent(req.subscriptionRef)}`,
			})
			const identified = current.plan_id ? identifyPlan(current.plan_id, process.env) : null
			if (!identified) {
				throw new RazorpayConfigError(
					`Cannot resolve the billing cohort for subscription "${req.subscriptionRef}"; refusing to schedule a plan change.`,
				)
			}

			const planId = resolvePlanId(req.tier, req.cycle, identified.cohort === "founding", process.env)
			const updated = await http.request<RazorpaySubscription>({
				method: "PATCH",
				path: `/subscriptions/${encodeURIComponent(req.subscriptionRef)}`,
				body: { plan_id: planId, schedule_change_at: "cycle_end", customer_notify: true },
			})

			return {
				subscriptionRef: req.subscriptionRef,
				tier: req.tier,
				cycle: req.cycle,
				effectiveAt: effectiveAtFor(updated),
				scheduledChangeRef: scheduledChangeRef(req.subscriptionRef, updated),
			}
		},

		async retrieveScheduledChange(subscriptionRef: string): Promise<SchedulePlanChangeResult | null> {
			const subscription = await http.request<RazorpaySubscription>({
				method: "GET",
				path: `/subscriptions/${encodeURIComponent(subscriptionRef)}/retrieve_scheduled_changes`,
			})
			if (subscription.has_scheduled_changes !== true) return null

			const identified = subscription.plan_id ? identifyPlan(subscription.plan_id, process.env) : null
			if (!identified) {
				throw new RazorpayConfigError(
					`Cannot map the scheduled Razorpay plan "${String(subscription.plan_id)}" back to a tier/cycle.`,
				)
			}

			return {
				subscriptionRef,
				tier: identified.tier,
				cycle: identified.cycle,
				effectiveAt: effectiveAtFor(subscription),
				scheduledChangeRef: scheduledChangeRef(subscriptionRef, subscription),
			}
		},

		async cancelScheduledChange(subscriptionRef: string): Promise<void> {
			await http.request<RazorpaySubscription>({
				method: "POST",
				path: `/subscriptions/${encodeURIComponent(subscriptionRef)}/cancel_scheduled_changes`,
			})
		},

		async getSubscriptionState(subscriptionRef: string): Promise<GatewaySubscriptionState> {
			const subscription = await http.request<RazorpaySubscription>({
				method: "GET",
				path: `/subscriptions/${encodeURIComponent(subscriptionRef)}`,
			})
			return {
				subscriptionRef: subscription.id ?? subscriptionRef,
				status: mapStatus(subscription.status),
				// Razorpay does not document a pending cycle-end-cancel flag on the
				// read-back object; honour one when reported, else fall back to the
				// conservative `live` classification until the terminal `cancelled`
				// state is read back at cycle end (reconciliation converges it).
				cancelAtPeriodEnd: subscription.cancel_at_cycle_end === true,
				currentPeriodEnd: unixToIso(subscription.current_end),
			}
		},
	}
}

/**
 * Singleton registered into the T5 factory seam. Construction never reads env;
 * credentials are only required when a request is actually made.
 */
export const razorpayGateway: RazorpayGateway = createRazorpayGateway()
