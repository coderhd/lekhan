/**
 * T8 — server-only webhook processor for both billing rails (plan T8; spec §6/§13;
 * PRD US-12; TL A4; PDEC-2/3).
 *
 * ROUTES ARE THIN: `app/api/billing/webhooks/{stripe,razorpay}/route.ts` hand the
 * raw request to `processStripeWebhook` / `processRazorpayWebhook` and map the
 * returned `WebhookResult` to an HTTP response. The processing order is hard
 * (spec §6):
 *
 *  1. SIGNATURE VERIFY — Stripe SDK `constructEvent` (`STRIPE_WEBHOOK_SECRET`) /
 *     Razorpay hex HMAC-SHA256 via `node:crypto` timing-safe-equal
 *     (`RAZORPAY_WEBHOOK_SECRET`). Failure ⇒ 400, nothing recorded
 *     (spec §13 "Never: process unverified webhooks").
 *  2. RAW RECORD — insert into `gateway_events` before any effect. The
 *     `event_id` UNIQUE makes replays of already-processed events short-circuit
 *     200; a conflict on an UNPROCESSED row (processor crashed mid-flight) is
 *     repaired on redelivery — the apply below is idempotent.
 *  3. READ-BACK — the verified event is a POINTER: the live subscription is
 *     re-fetched from the provider API (adapter-seamed) and entitlement state
 *     is written from the read-back object. The raw payload is audit-only —
 *     forged payload deltas and out-of-order deliveries converge to provider
 *     truth (never blind-downgrade, spec §6/§13).
 *  4. APPLY — `workspace_plans` upsert keyed by the workspace (billing root):
 *     status/tier/cycle/currency/is_founding/customer + subscription refs/
 *     gateway-mirrored `current_period_end`/`cancel_at_period_end`/seats;
 *     `past_due_since` set on the past_due transition (never reset while still
 *     past_due), cleared on recovery. "Canceling" is status=active +
 *     `cancel_at_period_end=true` (the schema has no 'canceling' status value;
 *     this matches the PDEC-11 detaching classification). A TERMINAL
 *     cancellation (provider reports canceled, or a deletion notice whose
 *     read-back is gone) writes tier='free'/billing_cycle='none' — fail-safe
 *     for readers that key on `.tier` — and mirrors 'free' to the owner's
 *     `profiles.plan` (deprecated mirror; normalized values only, never
 *     `go`/`enterprise`).
 *  5. REFERRAL HOOKS (TL A4 wiring) — AFTER the entitlement apply:
 *     paid-conversion events (Stripe `checkout.session.completed`, Razorpay
 *     `subscription.authenticated`) invoke T9's `grantConversionIfReferred`;
 *     renewal events (Stripe `invoice.paid`, Razorpay `subscription.charged`)
 *     invoke T9's `applyCreditsAtRenewal` (a no-op on INR rows per PDEC-2).
 *     Hook failures propagate: the event stays recorded/unprocessed so the
 *     provider's redelivery retries it — per-stage dedup + the bank cap make
 *     retries safe.
 *  6. UNKNOWN event types are stored, marked processed, and no-op — never a
 *     blind downgrade; the T10 reconciliation cron converges any residual
 *     divergence.
 *
 * Every provider/config/db failure after the raw record returns 502 with the
 * row left recorded and `processed_at` NULL, so the provider's redelivery (or
 * reconciliation) repairs it idempotently. Logs are PII-minimized: event id,
 * type and failure detail only — never the payload.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import Stripe from "stripe"

import type { BillingCycle, BillingTier, GatewaySubscriptionStatus, Rail } from "@/lib/billing/gateway"
import {
	RazorpayApiError,
	createRazorpayHttpClient,
	type RazorpayHttpClient,
	type RazorpaySubscription,
} from "@/lib/billing/razorpay"
import { normalizeLegacyPlan } from "@/lib/billing/legacy-plan-normalization"
import {
	resolvePriceRequest,
	type BillingCurrency,
	type PriceCohort,
	type RazorpayPriceResolution,
	type StripePriceResolution,
} from "@/lib/billing/prices"
import { getStripeClient } from "@/lib/billing/stripe"
import { applyCreditsAtRenewal, grantConversionIfReferred } from "./referral-credits"

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type WebhookRail = Rail

export type WebhookResultCode =
	| "processed"
	| "duplicate"
	| "ignored"
	| "unverified"
	| "webhook_config"
	| "processing_failed"

export interface WebhookResult {
	status: number
	code: WebhookResultCode
	eventId?: string
	detail?: string
}

/** Provider-truth read of the subscription behind an event pointer (step 3). */
export interface SubscriptionReadBack {
	subscriptionRef: string
	customerRef: string | null
	/** Workspace binding read from the provider object (metadata/notes). */
	workspaceId: string | null
	status: GatewaySubscriptionStatus
	cancelAtPeriodEnd: boolean
	currentPeriodEnd: string | null
	/** Reverse-mapped from the provider price/plan id via T2 env bindings. */
	tier: BillingTier | null
	cycle: BillingCycle | null
	isFounding: boolean
	seats: number | null
}

export type ReadSubscription = (subscriptionRef: string) => Promise<SubscriptionReadBack | null>

/** Output of the rail-specific verification step (step 1). */
export interface VerifiedWebhookEvent {
	eventId: string
	eventType: string
	/** Provider object the event points at (a subscription id), when mapped. */
	pointerRef: string | null
	/** `deletion` marks terminal-notice semantics for the gone-read-back fallback. */
	pointerKind: "subscription" | "deletion"
	/** The verified raw payload — audit-only (stored, never applied). */
	payload: unknown
}

export type VerifyWebhook = (rawBody: string, signature: string) => VerifiedWebhookEvent

export interface WebhookProcessorDeps {
	db: SupabaseClient
	/** Default: the rail's real verification (Stripe SDK / Razorpay HMAC). */
	verify?: VerifyWebhook
	/** Default: the rail's real provider read-back (adapter-seamed). */
	readSubscription?: ReadSubscription
	/** Transport for the default Razorpay read-back (T7 seam). */
	razorpayHttp?: RazorpayHttpClient
	/** T9 hooks (TL A4); defaults call `services/billing/referral-credits`. */
	grantConversion?: (workspaceId: string) => Promise<unknown>
	applyRenewalCredits?: (workspaceId: string) => Promise<unknown>
	now?: () => Date
}

/** Missing/blocked webhook secrets. Fails closed — the route can never process. */
export class WebhookConfigError extends Error {
	readonly code = "webhook_config"
	constructor(message: string) {
		super(message)
		this.name = "WebhookConfigError"
	}
}

// ---------------------------------------------------------------------------
// Event-type mapping (spec §6 step 5)
// ---------------------------------------------------------------------------

/** Paid-conversion events ⇒ T9 `grantConversionIfReferred` after the apply (TL A4). */
const CONVERSION_EVENTS: ReadonlySet<string> = new Set(["checkout.session.completed", "subscription.authenticated"])

/** Renewal events ⇒ T9 `applyCreditsAtRenewal` after the apply (Stripe-only inside T9; PDEC-2). */
const RENEWAL_EVENTS: ReadonlySet<string> = new Set(["invoice.paid", "subscription.charged"])

/** Stripe event types the processor maps; everything else is stored + no-op. */
const STRIPE_MAPPED_EVENTS: ReadonlySet<string> = new Set([
	"checkout.session.completed",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"invoice.paid",
	"invoice.payment_failed",
])

/** Razorpay event types the processor maps (plan T8); everything else no-ops. */
const RAZORPAY_MAPPED_EVENTS: ReadonlySet<string> = new Set([
	"subscription.authenticated",
	"subscription.activated",
	"subscription.charged",
	"subscription.completed",
	"subscription.cancelled",
	"subscription.pending",
	"subscription.halted",
])

const CURRENCY_OF_RAIL: Record<WebhookRail, BillingCurrency> = { stripe: "USD", razorpay: "INR" }

// ---------------------------------------------------------------------------
// Verification (step 1)
// ---------------------------------------------------------------------------

/** Razorpay scheme: hex HMAC-SHA256 of the raw request body, timing-safe compare. */
export function razorpaySignatureMatches(rawBody: string, signature: string, secret: string): boolean {
	const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
	const a = Buffer.from(expected, "hex")
	const b = Buffer.from(signature, "hex")
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

// ---------------------------------------------------------------------------
// Price/plan reverse-mapping — T2 `resolvePriceRequest` is the only mapping
// authority (env-bound); the processor never trusts a payload-declared tier.
// ---------------------------------------------------------------------------

interface IdentifiedPrice {
	tier: BillingTier
	cycle: BillingCycle
	cohort: PriceCohort
}

function identifyPriceObject(rail: WebhookRail, id: string): IdentifiedPrice | null {
	const currency: BillingCurrency = CURRENCY_OF_RAIL[rail]
	const matches: IdentifiedPrice[] = []
	for (const tier of ["plus", "pro", "team"] as const) {
		for (const cycle of ["monthly", "annual"] as const) {
			for (const cohort of ["founding", "ga"] as const) {
				try {
					const resolution = resolvePriceRequest(tier, cycle, currency, cohort === "founding")
					const bound =
						rail === "stripe"
							? (resolution as StripePriceResolution).priceId
							: process.env[(resolution as RazorpayPriceResolution).planEnvKey]
					// Provider ids are exact; env values may carry operator-pasted
					// whitespace (T7 LOW-3). Compare trimmed so a padded plan id still
					// reverse-maps instead of 502-ing every webhook for the rail.
					if (typeof bound === "string" && bound.trim() === id.trim()) matches.push({ tier, cycle, cohort })
				} catch {
					// Unbound combo (PriceConfigError) or non-sellable Team+INR
					// (TierUnavailableError): that combo simply is not a candidate.
				}
			}
		}
	}
	if (matches.length === 0) return null

	const [first] = matches
	// A price/plan id bound to several tier/cycle/cohort keys is a misconfiguration
	// that could misprice an entitlement (PDEC-12 leak guard): refuse, never guess.
	const unanimous = matches.every(
		(m) => m.tier === first.tier && m.cycle === first.cycle && m.cohort === first.cohort,
	)
	if (!unanimous) {
		throw new WebhookConfigError(
			`Price/plan id "${id}" is bound to multiple tier/cycle/cohort env keys; refusing to infer entitlement state.`,
		)
	}
	return first
}

// ---------------------------------------------------------------------------
// Default provider read-backs (step 3) — adapter-seamed, injectable in tests
// ---------------------------------------------------------------------------

/** Parity with the T6 rail's status mapping (trial is entitled; unknown ⇒ incomplete). */
function stripeStatusOf(status: string): GatewaySubscriptionStatus {
	switch (status) {
		case "active":
		case "trialing":
			return "active"
		case "past_due":
		case "unpaid":
			return "past_due"
		case "canceled":
		case "incomplete_expired":
			return "canceled"
		default:
			return "incomplete"
	}
}

function isResourceMissing(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "resource_missing"
}

function defaultStripeReadBack(): ReadSubscription {
	return async (subscriptionRef) => {
		const client = getStripeClient()
		try {
			const sub = await client.subscriptions.retrieve(subscriptionRef)
			const item = sub.items?.data?.[0]
			const priceId = item?.price?.id
			const identified = priceId ? identifyPriceObject("stripe", priceId) : null
			const metadata = sub.metadata ?? null
			const customer = sub.customer
			const foundingFromMetadata = typeof metadata?.is_founding === "string" ? metadata.is_founding === "true" : null
			return {
				subscriptionRef,
				customerRef: typeof customer === "string" ? customer : (customer?.id ?? null),
				workspaceId: typeof metadata?.workspace_id === "string" && metadata.workspace_id ? metadata.workspace_id : null,
				status: stripeStatusOf(sub.status),
				cancelAtPeriodEnd: sub.cancel_at_period_end === true,
				currentPeriodEnd:
					typeof item?.current_period_end === "number" ? new Date(item.current_period_end * 1000).toISOString() : null,
				tier: identified?.tier ?? null,
				cycle: identified?.cycle ?? null,
				// Spec §15: founding is persisted at creation on the provider object and
				// never re-derived — metadata is the record, the price cohort the fallback.
				isFounding: foundingFromMetadata ?? identified?.cohort === "founding",
				seats: typeof item?.quantity === "number" ? item.quantity : 1,
			}
		} catch (err) {
			if (isResourceMissing(err)) return null
			throw err
		}
	}
}

/**
 * Razorpay read-back status mapping. Divergence from the T7 rail map is
 * deliberate: the rail maps unknown statuses fail-closed-for-checkout
 * (unknown ⇒ active, blocking a double charge); the PROCESSOR writes
 * entitlements, where guessing "active" from an unrecognized status could
 * grant one — so unknown statuses fail the processing loudly instead.
 */
const RAZORPAY_READBACK_STATUS: Record<string, GatewaySubscriptionStatus> = {
	active: "active",
	authenticated: "active",
	pending: "past_due",
	halted: "past_due",
	cancelled: "canceled",
	completed: "canceled",
	expired: "canceled",
	created: "incomplete",
}

function defaultRazorpayReadBack(http: RazorpayHttpClient): ReadSubscription {
	return async (subscriptionRef) => {
		let sub: RazorpaySubscription
		try {
			sub = await http.request<RazorpaySubscription>({
				method: "GET",
				path: `/subscriptions/${encodeURIComponent(subscriptionRef)}`,
			})
		} catch (err) {
			if (err instanceof RazorpayApiError && err.status === 404) return null
			throw err
		}

		const status = typeof sub.status === "string" ? RAZORPAY_READBACK_STATUS[sub.status] : undefined
		if (!status) {
			throw new WebhookConfigError(
				`Razorpay read-back reported unrecognized subscription status "${String(sub.status)}"; refusing to write entitlement state.`,
			)
		}
		const identified = sub.plan_id ? identifyPriceObject("razorpay", sub.plan_id) : null
		const notes = sub.notes ?? null
		const foundingFromNotes = typeof notes?.is_founding === "string" ? notes.is_founding === "true" : null
		return {
			subscriptionRef: sub.id ?? subscriptionRef,
			customerRef: sub.customer_id ?? null,
			workspaceId: typeof notes?.workspace_id === "string" && notes.workspace_id ? notes.workspace_id : null,
			status,
			cancelAtPeriodEnd: sub.cancel_at_cycle_end === true,
			currentPeriodEnd:
				typeof sub.current_end === "number" && Number.isFinite(sub.current_end)
					? new Date(sub.current_end * 1000).toISOString()
					: null,
			tier: identified?.tier ?? null,
			cycle: identified?.cycle ?? null,
			isFounding: foundingFromNotes ?? identified?.cohort === "founding",
			seats: typeof sub.quantity === "number" ? sub.quantity : 1,
		}
	}
}

// ---------------------------------------------------------------------------
// Shared pipeline (steps 2-6)
// ---------------------------------------------------------------------------

interface ResolvedDeps {
	db: SupabaseClient
	verify?: VerifyWebhook
	readSubscription: ReadSubscription
	razorpayHttp: RazorpayHttpClient
	grantConversion: (workspaceId: string) => Promise<unknown>
	applyRenewalCredits: (workspaceId: string) => Promise<unknown>
	now: () => Date
}

function resolveDeps(db: SupabaseClient, over: Partial<WebhookProcessorDeps> | undefined, rail: WebhookRail): ResolvedDeps {
	const razorpayHttp = over?.razorpayHttp ?? createRazorpayHttpClient()
	return {
		db,
		verify: over?.verify,
		razorpayHttp,
		readSubscription: over?.readSubscription ?? (rail === "stripe" ? defaultStripeReadBack() : defaultRazorpayReadBack(razorpayHttp)),
		grantConversion: over?.grantConversion ?? ((workspaceId: string) => grantConversionIfReferred(db, workspaceId)),
		applyRenewalCredits: over?.applyRenewalCredits ?? ((workspaceId: string) => applyCreditsAtRenewal(db, workspaceId)),
		now: over?.now ?? (() => new Date()),
	}
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
	return error?.code === "23505"
}

function processingFailed(eventId: string, detail: string): WebhookResult {
	return { status: 502, code: "processing_failed", eventId, detail }
}

/** Step 2/6 close-out: the event is durably handled (applied, or no-op). */
async function markProcessedFor(deps: ResolvedDeps, eventId: string): Promise<WebhookResult> {
	const upd = await deps.db
		.from("gateway_events")
		.update({ processed_at: deps.now().toISOString() })
		.eq("event_id", eventId)
	if (upd.error) return processingFailed(eventId, `processed_at update failed: ${upd.error.message}`)
	return { status: 200, code: "processed", eventId }
}

/** Stored + marked + no-op (unknown event types, vanished pointers — never blind-downgrade). */
async function ignoreEvent(deps: ResolvedDeps, eventId: string, detail: string): Promise<WebhookResult> {
	const upd = await deps.db
		.from("gateway_events")
		.update({ processed_at: deps.now().toISOString() })
		.eq("event_id", eventId)
	if (upd.error) return processingFailed(eventId, `processed_at update failed: ${upd.error.message}`)
	return { status: 200, code: "ignored", eventId, detail }
}

function eventRowFor(rail: WebhookRail, event: VerifiedWebhookEvent) {
	return {
		gateway: rail,
		event_id: event.eventId,
		type: event.eventType,
		payload: (event.payload ?? {}) as Record<string, unknown>,
		processed_at: null,
	}
}

async function processVerifiedEvent(rail: WebhookRail, deps: ResolvedDeps, event: VerifiedWebhookEvent): Promise<WebhookResult> {
	const { db, readSubscription } = deps

	// (2) RAW RECORD BEFORE PROCESSING (spec §13). The insert is the idempotency
	// gate: a processed-event replay short-circuits; a conflict on an unprocessed
	// row means a processor crashed mid-flight — the redelivery repairs it.
	const inserted = await db
		.from("gateway_events")
		.insert(eventRowFor(rail, event))
		.select("id")
	if (inserted.error) {
		if (!isUniqueViolation(inserted.error)) {
			return processingFailed(event.eventId, `raw record insert failed: ${inserted.error.message}`)
		}
		const existing = await db
			.from("gateway_events")
			.select("processed_at")
			.eq("event_id", event.eventId)
			.maybeSingle()
		if (existing.error) return processingFailed(event.eventId, `duplicate lookup failed: ${existing.error.message}`)
		const processedAt = (existing.data as { processed_at: string | null } | null)?.processed_at ?? null
		if (processedAt != null) {
			// Duplicate delivery of an already-processed event (US-12): short-circuit.
			return { status: 200, code: "duplicate", eventId: event.eventId }
		}
		// Unprocessed conflict: fall through and repair (apply is idempotent).
	}

	const ignore = (detail: string) => ignoreEvent(deps, event.eventId, detail)

	// (6) No pointer ⇒ unknown event type, or a mapped event without a usable
	// subscription reference: stored + no-op — never blind-downgrade.
	if (!event.pointerRef) {
		return ignore("no subscription pointer; nothing to converge")
	}

	// (3) READ-BACK — the event is a pointer; entitlement state comes from the
	// live provider object, never the payload (spec §6).
	let state: SubscriptionReadBack | null
	try {
		state = await readSubscription(event.pointerRef)
	} catch (err) {
		// PII-minimized: provider error objects may embed response bodies.
		console.error(`[billing/webhooks] ${rail} provider read-back failed`, {
			eventId: event.eventId,
			type: event.eventType,
			err: err instanceof Error ? err.message : "read-back failed",
		})
		return processingFailed(event.eventId, "provider read-back failed")
	}

	if (!state) {
		// Provider reports the pointed-at subscription gone.
		if (event.pointerKind === "deletion") {
			// Terminal notice + gone read-back: converge via the workspace binding
			// we already store (DB truth, not payload truth).
			const bound = await db
				.from("workspace_plans")
				.select("workspace_id, gateway_customer_id")
				.eq("gateway_subscription_id", event.pointerRef)
				.eq("gateway", rail)
				.maybeSingle()
			if (bound.error) return processingFailed(event.eventId, `binding lookup failed: ${bound.error.message}`)
			const boundRow = (bound.data as { workspace_id: string; gateway_customer_id: string | null } | null) ?? null
			if (!boundRow?.workspace_id) return ignore("deleted subscription is gone and no bound workspace row exists")
			const gone: SubscriptionReadBack = {
				subscriptionRef: event.pointerRef,
				// Preserve the stored customer binding so a resubscribe reuses the same
				// provider customer (US-6 AC2) — the read-back is gone, the DB row isn't.
				customerRef: boundRow.gateway_customer_id ?? null,
				workspaceId: boundRow.workspace_id,
				status: "canceled",
				cancelAtPeriodEnd: false,
				currentPeriodEnd: null,
				tier: null,
				cycle: null,
				isFounding: false,
				seats: null,
			}
			return applyAndFinish(rail, deps, event, gone)
		}
		return ignore("pointed-at subscription no longer exists on the provider")
	}

	if (!state.workspaceId) {
		// Without the provider-side workspace binding there is no billing root to
		// write — fail loud (row recorded, unprocessed) rather than guess.
		return processingFailed(event.eventId, "provider subscription read-back carries no workspace binding")
	}

	return applyAndFinish(rail, deps, event, state)
}

async function applyAndFinish(
	rail: WebhookRail,
	deps: ResolvedDeps,
	event: VerifiedWebhookEvent,
	state: SubscriptionReadBack,
): Promise<WebhookResult> {
	const { db, now, grantConversion, applyRenewalCredits } = deps
	const workspaceId = state.workspaceId as string
	const terminal = state.status === "canceled"

	// Non-terminal applications need a mapped tier/cycle (T2 reverse-map). An
	// unmapped price/plan id is a config fault — fail loud, write nothing.
	if (!terminal && (state.tier == null || state.cycle == null)) {
		return processingFailed(event.eventId, "provider read-back price/plan id is not bound to a tier/cycle in env")
	}

	const existing = await db
		.from("workspace_plans")
		.select("status, past_due_since, gateway, gateway_subscription_id, cancel_at_period_end")
		.eq("workspace_id", workspaceId)
		.maybeSingle()
	if (existing.error) return processingFailed(event.eventId, `plan read failed: ${existing.error.message}`)
	const previous = (existing.data ?? null) as {
		status: string
		past_due_since: string | null
		gateway: string | null
		gateway_subscription_id: string | null
		cancel_at_period_end: boolean | null
	} | null

	// Stale-generation guard (clean-room N-1): a TERMINAL read-back for a
	// subscription ref that differs from the stored LIVE binding belongs to a
	// previous generation (cancel → resubscribe; the old subscription's deleted
	// event can arrive after the new one activated). Never clobber the live
	// generation with stale terminal state — the fail direction would be
	// over-restricting a paying workspace; residual divergence is left to
	// reconciliation (spec §15). Non-terminal applies and same-ref applies pass
	// through; a live detaching row awaiting its replacement rail's activation
	// is only ever terminal-applied by its OWN ref (equal ⇒ not stale).
	if (
		terminal &&
		previous &&
		(previous.status === "active" || previous.status === "past_due") &&
		previous.gateway_subscription_id &&
		previous.gateway_subscription_id !== state.subscriptionRef
	) {
		console.warn(`[billing/webhooks] ${rail} stale-generation terminal event ignored for a live binding`, {
			eventId: event.eventId,
			eventType: event.eventType,
		})
		return markProcessedFor(deps, event.eventId)
	}

	// past_due clock (spec §6 step 4): set on the transition, never reset while
	// still past_due, cleared on recovery — the 7-day grace window (D9) reads it.
	const wasPastDue = previous?.status === "past_due"
	const pastDueSince =
		state.status === "past_due" ? (wasPastDue ? (previous?.past_due_since ?? now().toISOString()) : now().toISOString()) : null

	// Razorpay never echoes cancel-at-cycle-end on the subscription object (T7/SIL-56
	// binding ruling): the provider read-back cannot clear a cancellation the user
	// already accepted. Preserve the stored flag for the SAME live subscription;
	// Stripe keeps mirroring the provider and a new generation starts clean.
	const sameRazorpayGeneration =
		rail === "razorpay" && previous?.gateway === "razorpay" && previous.gateway_subscription_id === state.subscriptionRef
	const cancelAtPeriodEnd =
		!state.cancelAtPeriodEnd && sameRazorpayGeneration ? previous?.cancel_at_period_end === true : state.cancelAtPeriodEnd

	// (4) APPLY — upsert from the read-back object only.
	const patch = (
		terminal
			? {
					workspace_id: workspaceId,
					tier: "free",
					billing_cycle: "none",
					status: state.status,
					gateway: rail,
					gateway_customer_id: state.customerRef,
					gateway_subscription_id: state.subscriptionRef,
					currency: CURRENCY_OF_RAIL[rail],
					current_period_end: state.currentPeriodEnd,
					cancel_at_period_end: false,
					past_due_since: null,
					seats: state.seats,
					updated_at: now().toISOString(),
				}
			: {
					workspace_id: workspaceId,
					tier: state.tier as BillingTier,
					billing_cycle: state.cycle as BillingCycle,
					status: state.status,
					gateway: rail,
					gateway_customer_id: state.customerRef,
					gateway_subscription_id: state.subscriptionRef,
					currency: CURRENCY_OF_RAIL[rail],
					is_founding: state.isFounding,
					seats: state.seats,
					current_period_end: state.currentPeriodEnd,
					cancel_at_period_end: cancelAtPeriodEnd,
					past_due_since: pastDueSince,
					updated_at: now().toISOString(),
				}
		) as Record<string, unknown>

	const upserted = await db.from("workspace_plans").upsert(patch, { onConflict: "workspace_id" })
	if (upserted.error) return processingFailed(event.eventId, `plan upsert failed: ${upserted.error.message}`)

	// (4b) Deprecated `profiles.plan` mirror — the owner's profile, normalized
	// values only (never go/enterprise); entitled statuses mirror the tier,
	// terminal/incomplete states mirror free. Parity is pinned by T11's tests.
	const owner = await db.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle()
	if (owner.error) return processingFailed(event.eventId, `workspace read failed: ${owner.error.message}`)
	const ownerId = (owner.data as { owner_id: string } | null)?.owner_id ?? null
	if (!ownerId) return processingFailed(event.eventId, "workspace row missing for mirror update")
	const mirrorPlan =
		state.status === "active" || state.status === "past_due" ? normalizeLegacyPlan(state.tier ?? undefined) : "free"
	const mirrored = await db.from("profiles").update({ plan: mirrorPlan }).eq("id", ownerId)
	if (mirrored.error) return processingFailed(event.eventId, `mirror update failed: ${mirrored.error.message}`)

	// (5) Referral hooks AFTER the entitlement apply (TL A4). Failures propagate:
	// the event stays recorded/unprocessed so redelivery retries the hook.
	//
	// Conversion requires actual entitlement (read-back active/past_due): Stripe
	// emits `checkout.session.completed` for async/3DS flows whose subscription is
	// still `incomplete`/unpaid — granting then would let an unpaid checkout bank
	// a referral month. Razorpay's `subscription.authenticated` is likewise an
	// authorization, not proof of a captured charge.
	const conversionEntitled = state.status === "active" || state.status === "past_due"
	try {
		if (CONVERSION_EVENTS.has(event.eventType)) {
			if (conversionEntitled) await grantConversion(workspaceId)
		} else if (RENEWAL_EVENTS.has(event.eventType)) {
			await applyRenewalCredits(workspaceId)
		}
	} catch (err) {
		// PII-minimized: provider/hook error objects may embed response bodies.
		console.error(`[billing/webhooks] ${rail} referral hook failed`, {
			eventId: event.eventId,
			type: event.eventType,
			err: err instanceof Error ? err.message : "hook failed",
		})
		return processingFailed(event.eventId, "referral hook failed")
	}

	return markProcessedFor(deps, event.eventId)
}

// ---------------------------------------------------------------------------
// Rail entries (step 1 lives here for each rail; routes stay thin)
// ---------------------------------------------------------------------------

/**
 * Subscription pointer of a Stripe invoice. The pinned API version
 * (`2026-09-30.endive`, post-Basil) moved the field from the invoice root to
 * `parent.subscription_details.subscription`; the legacy top-level field is
 * still accepted so an endpoint deliberately pinned to a pre-Basil version
 * keeps working. Never trust any other payload field.
 */
function stripeInvoiceSubscriptionRef(obj: Record<string, unknown>): string | null {
	const parent = obj.parent as
		| { subscription_details?: { subscription?: unknown } | null }
		| null
		| undefined
	const nested = parent?.subscription_details?.subscription
	if (typeof nested === "string" && nested) return nested
	return typeof obj.subscription === "string" && obj.subscription ? obj.subscription : null
}

function stripePointerOf(event: Stripe.Event): { pointerRef: string | null; pointerKind: "subscription" | "deletion" } {
	const obj = (event.data?.object ?? {}) as unknown as Record<string, unknown>
	switch (event.type) {
		case "checkout.session.completed":
			return {
				pointerRef: typeof obj.subscription === "string" && obj.subscription ? obj.subscription : null,
				pointerKind: "subscription",
			}
		case "invoice.paid":
		case "invoice.payment_failed":
			return {
				pointerRef: stripeInvoiceSubscriptionRef(obj),
				pointerKind: "subscription",
			}
		case "customer.subscription.updated":
			return { pointerRef: typeof obj.id === "string" && obj.id ? obj.id : null, pointerKind: "subscription" }
		case "customer.subscription.deleted":
			return { pointerRef: typeof obj.id === "string" && obj.id ? obj.id : null, pointerKind: "deletion" }
		default:
			return { pointerRef: null, pointerKind: "subscription" }
	}
}

/** Process a verified-or-not Stripe webhook delivery; returns the HTTP mapping. */
export async function processStripeWebhook(input: {
	db: SupabaseClient
	rawBody: string
	signature: string
	deps?: Partial<WebhookProcessorDeps>
}): Promise<WebhookResult> {
	const deps = resolveDeps(input.db, input.deps, "stripe")

	// (1) SIGNATURE VERIFY — fail closed before ANY effect (spec §13). The secret
	// is required for the real verification path; an injected `verify` (tests)
	// replaces the whole step, so the default secret is not consulted.
	const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
	if (!deps.verify && !secret) {
		console.error("[billing/webhooks] STRIPE_WEBHOOK_SECRET is not set")
		return { status: 500, code: "webhook_config", detail: "webhook secret is not configured" }
	}

	let event: VerifiedWebhookEvent
	try {
		if (deps.verify) {
			event = deps.verify(input.rawBody, input.signature)
		} else {
			const parsed = Stripe.webhooks.constructEvent(input.rawBody, input.signature, secret as string)
			const pointer = stripePointerOf(parsed)
			event = {
				eventId: parsed.id,
				eventType: parsed.type,
				pointerRef: STRIPE_MAPPED_EVENTS.has(parsed.type) ? pointer.pointerRef : null,
				pointerKind: pointer.pointerKind,
				payload: parsed,
			}
		}
	} catch (err) {
		// PII-minimized (spec §14): StripeSignatureVerificationError carries the raw
		// unverified payload + signature header — log the message only, never the
		// error object (this file logs the payload never).
		console.error("[billing/webhooks] stripe signature verification failed:", err instanceof Error ? err.message : "verify failed")
		return { status: 400, code: "unverified" }
	}

	return processVerifiedEvent("stripe", deps, event)
}

/** Process a verified-or-not Razorpay webhook delivery; returns the HTTP mapping. */
export async function processRazorpayWebhook(input: {
	db: SupabaseClient
	rawBody: string
	signature: string
	/** `X-Razorpay-Event-Id` header value, when the provider sends it. */
	eventId?: string
	deps?: Partial<WebhookProcessorDeps>
}): Promise<WebhookResult> {
	const deps = resolveDeps(input.db, input.deps, "razorpay")

	// (1) SIGNATURE VERIFY — HMAC-SHA256 over the RAW body, timing-safe (spec §6).
	// The secret is required for the real verification path; an injected `verify`
	// (tests) replaces the whole step.
	const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
	if (!deps.verify && !secret) {
		console.error("[billing/webhooks] RAZORPAY_WEBHOOK_SECRET is not set")
		return { status: 500, code: "webhook_config", detail: "webhook secret is not configured" }
	}
	if (!deps.verify && (!input.signature || !razorpaySignatureMatches(input.rawBody, input.signature, secret as string))) {
		console.error("[billing/webhooks] razorpay signature verification failed")
		return { status: 400, code: "unverified" }
	}

	let event: VerifiedWebhookEvent
	if (deps.verify) {
		event = deps.verify(input.rawBody, input.signature)
	} else {
		let body: unknown
		try {
			body = JSON.parse(input.rawBody)
		} catch {
			return { status: 400, code: "unverified", detail: "invalid JSON body" }
		}

		const eventType =
			typeof (body as { event?: unknown })?.event === "string" ? ((body as { event: string }).event) : ""

		// Razorpay webhook envelopes carry no top-level event id: prefer the
		// `X-Razorpay-Event-Id` header, fall back to a content hash (identical
		// bodies dedupe identically; the apply is idempotent either way).
		const derivedEventId =
			input.eventId?.trim() || `rzp_${createHash("sha256").update(input.rawBody).digest("hex").slice(0, 32)}`

		const container = (body as { payload?: { subscription?: { entity?: { id?: unknown }; id?: unknown } } })
			?.payload?.subscription
		const entityId =
			container?.entity && typeof container.entity.id === "string"
				? container.entity.id
				: typeof container?.id === "string"
					? container.id
					: null

		event = {
			eventId: derivedEventId,
			eventType,
			pointerRef: RAZORPAY_MAPPED_EVENTS.has(eventType) && entityId ? entityId : null,
			pointerKind: "subscription",
			payload: body,
		}
	}

	return processVerifiedEvent("razorpay", deps, event)
}
