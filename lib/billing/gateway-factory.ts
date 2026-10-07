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
