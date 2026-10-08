/**
 * T6 — Stripe rail (global / USD). Server-only (spec §5, plan T6, PDEC-12).
 *
 * The Stripe SDK is a server-only import: card data never lands in Lekhan (hosted
 * Checkout + Billing Portal only ⇒ PCI SAQ-A, spec invariant 5). The rail never
 * accepts a client-declared amount, price, tier or cohort — every checkout line
 * item is resolved server-side by T2's `resolvePriceRequest` from env bindings.
 *
 * Plan-change mechanism (PDEC-12 / US-5): Stripe does not use a server-created
 * scheduled-change object. Both the generic portal and the plan-change deep link
 * ride the Billing Portal (subscription-update enabled in the dashboard); the
 * `schedulePlanChange` seam opens the subscription-update portal flow.
 *
 * The client is injectable so unit tests exercise request shape with no network;
 * the default client is built lazily on first use, so importing this module never
 * requires `STRIPE_SECRET_KEY`.
 */

import Stripe from "stripe"

import {
	SubscriptionNotFoundError,
	UnsupportedCurrencyError,
	assertSellableCheckout,
	type CheckoutRequest,
	type CheckoutSession,
	type GatewaySubscriptionState,
	type GatewaySubscriptionStatus,
	type PaymentGateway,
	type PortalSession,
	type SchedulePlanChangeRequest,
	type SchedulePlanChangeResult,
} from "./gateway"
import { resolvePriceRequest } from "./prices"

/** Pinned Stripe API version (plan T6) — never the implicit SDK default. */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-09-30.endive"

/** Missing/blocked Stripe server configuration. Fails closed, never a fallback. */
export class StripeConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "StripeConfigError"
	}
}

/**
 * The stored `gateway_customer_id` is carried on the rail request (US-6 AC2) so a
 * resubscribe reuses the existing Stripe customer instead of creating a second one.
 * Optional by design, so this shape still satisfies the frozen `PaymentGateway`
 * contract (`CheckoutRequest` remains the shared base).
 */
export interface StripeCheckoutRequest extends CheckoutRequest {
	customerRef?: string | null
}

export interface StripePaymentGateway extends Omit<PaymentGateway, "createCheckout"> {
	createCheckout(req: StripeCheckoutRequest): Promise<CheckoutSession>
}

function appUrl(): string {
	const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
	if (!raw) {
		throw new StripeConfigError("NEXT_PUBLIC_APP_URL must be set to build checkout/portal redirect URLs.")
	}
	return raw.replace(/\/+$/, "")
}

let cachedClient: Stripe | null = null

/** Lazily construct the real Stripe client so module import needs no secret (tests). */
function defaultStripeClient(): Stripe {
	if (cachedClient) return cachedClient
	const key = process.env.STRIPE_SECRET_KEY?.trim()
	if (!key) {
		throw new StripeConfigError("STRIPE_SECRET_KEY is not set; the Stripe rail is unavailable.")
	}
	cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 })
	return cachedClient
}

/**
 * Map a provider subscription status onto the entitlement vocabulary. Unknown or
 * trialing states are never treated as canceled (never blind-downgrade): trial is
 * entitled, unrecognized states are treated as incomplete.
 */
function mapStatus(status: string): GatewaySubscriptionStatus {
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

/**
 * `current_period_end` moved off the subscription root onto subscription items in
 * current Stripe API versions, so the period is read from the first item.
 */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
	const ts = subscription.items?.data?.[0]?.current_period_end
	return typeof ts === "number" ? new Date(ts * 1000).toISOString() : null
}

function customerIdOf(customer: Stripe.Subscription["customer"]): string {
	return typeof customer === "string" ? customer : customer.id
}

function isResourceMissing(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "resource_missing"
}

/**
 * Build the Stripe rail around an injectable client. The default client is
 * constructed lazily from `STRIPE_SECRET_KEY`.
 */
export function createStripeGateway(client?: Stripe): StripePaymentGateway {
	let resolved: Stripe | undefined = client
	const stripe = (): Stripe => (resolved ??= defaultStripeClient())

	return {
		rail: "stripe",

		async createCheckout(req: StripeCheckoutRequest): Promise<CheckoutSession> {
			if (req.currency !== "USD") throw new UnsupportedCurrencyError(req.currency)
			assertSellableCheckout(req)

			const resolution = resolvePriceRequest(req.tier, req.cycle, "USD", req.isFounding)
			if (!("priceId" in resolution)) {
				throw new StripeConfigError("Stripe checkout requires a resolved USD price object.")
			}

			const base = appUrl()
			const quantity = req.tier === "team" ? Math.max(1, Math.floor(req.seats ?? 1)) : 1

			const params: Stripe.Checkout.SessionCreateParams = {
				mode: "subscription",
				line_items: [{ price: resolution.priceId, quantity }],
				metadata: { workspace_id: req.workspaceId },
				// Founding cohort is persisted at creation and never re-derived (spec §15).
				subscription_data: {
					metadata: {
						workspace_id: req.workspaceId,
						is_founding: String(req.isFounding === true),
					},
				},
				success_url: `${base}/settings?billing=checkout_success`,
				cancel_url: `${base}/settings?billing=checkout_cancelled`,
			}

			// Reuse the stored customer on resubscribe; otherwise Checkout creates one
			// (T8 read-back persists its id) — never write `current_period_end` locally.
			if (req.customerRef) params.customer = req.customerRef

			const session = await stripe().checkout.sessions.create(params)
			if (!session.url) {
				throw new StripeConfigError("Stripe did not return a hosted checkout URL.")
			}
			return { checkoutUrl: session.url, opaqueRef: session.id }
		},

		async portalUrl(customerRef: string): Promise<PortalSession> {
			const session = await stripe().billingPortal.sessions.create({
				customer: customerRef,
				return_url: `${appUrl()}/settings?billing=portal_return`,
			})
			return { url: session.url, kind: "billing_portal" }
		},

		/**
		 * PDEC-12: Stripe plan changes are portal-native. Open the Billing Portal's
		 * subscription-update flow for this subscription; the period-end effect comes
		 * from the provider read-back, never a local write.
		 */
		async schedulePlanChange(req: SchedulePlanChangeRequest): Promise<SchedulePlanChangeResult> {
			const stripeClient = stripe()
			const subscription = await stripeClient.subscriptions.retrieve(req.subscriptionRef)
			// Read-back first, fail closed before opening a portal flow we would discard:
			// a missing period-end is a config/provider fault, never a `""` effect date.
			const effectiveAt = subscriptionPeriodEnd(subscription)
			if (!effectiveAt) {
				throw new StripeConfigError(
					`Stripe subscription "${req.subscriptionRef}" read-back omitted current_period_end; cannot report a plan-change effect.`,
				)
			}
			const session = await stripeClient.billingPortal.sessions.create({
				customer: customerIdOf(subscription.customer),
				return_url: `${appUrl()}/settings?billing=plan_change_return`,
				flow_data: {
					type: "subscription_update",
					subscription_update: { subscription: req.subscriptionRef },
				},
			})
			return {
				subscriptionRef: req.subscriptionRef,
				tier: req.tier,
				cycle: req.cycle,
				effectiveAt,
				scheduledChangeRef: session.id,
			}
		},

		async cancelAtPeriodEnd(subscriptionRef: string): Promise<void> {
			await stripe().subscriptions.update(subscriptionRef, { cancel_at_period_end: true })
		},

		async getSubscriptionState(subscriptionRef: string): Promise<GatewaySubscriptionState> {
			try {
				const subscription = await stripe().subscriptions.retrieve(subscriptionRef)
				return {
					subscriptionRef,
					status: mapStatus(subscription.status),
					cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
					currentPeriodEnd: subscriptionPeriodEnd(subscription),
				}
			} catch (err) {
				if (isResourceMissing(err)) throw new SubscriptionNotFoundError(subscriptionRef)
				throw err
			}
		},
	}
}

/**
 * Build the lazily-configured Stripe rail for factory registration (T5 seam).
 *
 * The factory lists this under exactly one `builtinRails` map entry as an arrow
 * wrapper (`stripe: () => getStripeGateway()`), so the binding is read only when
 * the loader runs — never during module evaluation inside the
 * (`gateway` ⇄ `gateway-factory`) import cycle. The real Stripe client stays lazy,
 * so registration never requires `STRIPE_SECRET_KEY`.
 */
export function getStripeGateway(): StripePaymentGateway {
	return createStripeGateway()
}
