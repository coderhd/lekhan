/**
 * T5 — self-registration seam for gateway rails.
 *
 * Built-in rails are listed one map entry each (T6 Stripe, T7 Razorpay); the
 * routing logic below is never edited when a rail is added:
 *
 *   const builtinRails = { stripe: () => getStripeGateway() }
 *
 * Entries are lazy loader functions, never gateway instances or bare function
 * references, for two reasons:
 *  - a rail's real client is built on first use, so importing this module (or
 *    merely registering a rail) never requires provider secrets; and
 *  - `gateway.ts` re-exports this module (spec §5's import site), so a rail module
 *    can be imported while the `gateway` ⇄ `gateway-factory` cycle is still
 *    resolving. Wrapping the rail binding in an arrow defers the read until the
 *    loader is invoked, keeping registration reliable under any import order (a
 *    bare reference is read during module evaluation and can silently bind
 *    `undefined`).
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
import { razorpayGateway } from "./razorpay"
import { getStripeGateway } from "./stripe"

const registry = new Map<Rail, PaymentGateway>()

export function registerGateway(rail: Rail, gateway: PaymentGateway): void {
	registry.set(rail, gateway)
}

/** Built-in rails: one lazy loader per rail (T6 stripe, T7 razorpay). */
const builtinRails: Partial<Record<Rail, () => PaymentGateway>> = {
	stripe: () => getStripeGateway(),
	// REVIEW BLOCKING-1 (SIL-43): the razorpay binding must be read only at load
	// time, never during this module's evaluation — under a razorpay-first import
	// graph the singleton is still in TDZ here. The lazy-loader seam is the guard
	// (T7's eager getter-delegate superseded at integration); the
	// `billing-razorpay-import-order` pin keeps it pinned permanently.
	razorpay: () => razorpayGateway,
}

/** Resolve a built-in rail's loader on first use (see module note). */
function ensureRegistered(rail: Rail): void {
	if (registry.has(rail)) return
	const load = builtinRails[rail]
	if (load) registerGateway(rail, load())
}

export function isFakePaymentsEnabled(): boolean {
	return process.env.LEKHAN_FAKE_PAYMENTS === "1"
}

export function gatewayForRail(rail: Rail): PaymentGateway {
	if (isFakePaymentsEnabled()) return getFakeGateway(rail)
	ensureRegistered(rail)
	const gateway = registry.get(rail)
	if (!gateway) throw new GatewayNotRegisteredError(rail)
	return gateway
}

export function gatewayForCurrency(currency: Currency): PaymentGateway {
	return gatewayForRail(railForCurrency(currency))
}

