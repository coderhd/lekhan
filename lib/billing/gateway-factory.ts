/**
 * T5 — self-registration seam for gateway rails.
 *
 * Rails register with a single line (T6 Stripe, T7 Razorpay); the routing logic
 * below is never edited when a rail is added:
 *
 *   registerGateway("stripe", stripeGateway)
 *
 * `LEKHAN_FAKE_PAYMENTS=1` short-circuits every rail to the in-memory fake so
 * UI/e2e flows run without money (spec §10).
 */

import {
	GatewayNotRegisteredError,
	railForCurrency,
	type Currency,
	type PaymentGateway,
	type Rail,
} from "./gateway"
import { getFakeGateway } from "./gateway-fake"
import { razorpayGateway, type RazorpayGateway } from "./razorpay"

const registry = new Map<Rail, PaymentGateway>()

export function registerGateway(rail: Rail, gateway: PaymentGateway): void {
	registry.set(rail, gateway)
}

export function isFakePaymentsEnabled(): boolean {
	return process.env.LEKHAN_FAKE_PAYMENTS === "1"
}

export function gatewayForRail(rail: Rail): PaymentGateway {
	if (isFakePaymentsEnabled()) return getFakeGateway(rail)
	const gateway = registry.get(rail)
	if (!gateway) throw new GatewayNotRegisteredError(rail)
	return gateway
}

export function gatewayForCurrency(currency: Currency): PaymentGateway {
	return gatewayForRail(railForCurrency(currency))
}

// Rails self-register here (T7 Razorpay; T6 Stripe in parallel). Registration
// touches no routing logic above.
//
// REVIEW BLOCKING-1 — registration must be *lazy*. `razorpay.ts` imports this module
// back through `gateway.ts`, so when the rail is the module-graph entry this file's
// body evaluates before `razorpay.ts`'s body: a direct
// `registerGateway("razorpay", razorpayGateway)` captures `undefined` (or throws a
// TDZ ReferenceError under native ESM). Every method below dereferences
// `razorpayGateway` only at call time, after the graph has fully evaluated, so the
// registration is real and callable under any static import order. The
// `billing-razorpay-import-order` pin guards this hazard permanently.
const razorpayGatewayDelegate: RazorpayGateway = {
	get rail() {
		return razorpayGateway.rail
	},
	createCheckout: (req) => razorpayGateway.createCheckout(req),
	portalUrl: (customerRef) => razorpayGateway.portalUrl(customerRef),
	schedulePlanChange: (req) => razorpayGateway.schedulePlanChange(req),
	cancelAtPeriodEnd: (subscriptionRef) => razorpayGateway.cancelAtPeriodEnd(subscriptionRef),
	getSubscriptionState: (subscriptionRef) => razorpayGateway.getSubscriptionState(subscriptionRef),
	retrieveScheduledChange: (subscriptionRef) => razorpayGateway.retrieveScheduledChange(subscriptionRef),
	cancelScheduledChange: (subscriptionRef) => razorpayGateway.cancelScheduledChange(subscriptionRef),
}

registerGateway("razorpay", razorpayGatewayDelegate)
