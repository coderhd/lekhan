/**
 * T5 — currency-agnostic checkout wrapper (plan T5, PDEC-8b).
 *
 * Thin route: authenticate → resolve the requester's own workspace → enforce the
 * single-live-non-detaching-subscription invariant (read-back-based) → delegate to
 * the rail selected solely by `gatewayForCurrency`. No amount, price id, or
 * founding flag is ever read from the request body (spec §13).
 */

import { NextRequest, NextResponse } from "next/server"
import {
	assertSellableCheckout,
	TEAM_REQUIRED_CURRENCY,
	TierUnavailableError,
	isBillingCycle,
	isBillingTier,
	isCurrency,
	isLiveNonDetaching,
	type Rail,
} from "@/lib/billing/gateway"
import { gatewayForCurrency, gatewayForRail } from "@/lib/billing/gateway-factory"
import {
	billingContextErrorResponse,
	createBillingAdminClient,
	getRequestUserId,
	resolveOwnerBilling,
} from "@/lib/billing/workspace-billing"

export async function POST(request: NextRequest): Promise<NextResponse> {
	const userId = await getRequestUserId(request)
	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
	}

	let body: unknown
	try {
		body = await request.json()
	} catch {
		return NextResponse.json({ error: "Invalid request body", code: "invalid_body" }, { status: 400 })
	}
	const input = (body ?? {}) as Record<string, unknown>
	const { tier, cycle, currency } = input
	if (!isBillingTier(tier) || !isBillingCycle(cycle) || !isCurrency(currency)) {
		return NextResponse.json(
			{ error: "tier, cycle and currency are required and must be valid.", code: "invalid_checkout_request" },
			{ status: 400 },
		)
	}
	const seats = typeof input.seats === "number" && Number.isFinite(input.seats) ? input.seats : undefined

	const admin = createBillingAdminClient()
	let context
	try {
		context = await resolveOwnerBilling(admin, userId)
	} catch (err) {
		return billingContextErrorResponse(err)
	}

	try {
		assertSellableCheckout({ tier, currency })
	} catch (err) {
		if (err instanceof TierUnavailableError) {
			return NextResponse.json(
				{ error: err.message, code: "tier_unavailable", requiredCurrency: TEAM_REQUIRED_CURRENCY },
				{ status: 400 },
			)
		}
		throw err
	}

	// Single-live-subscription invariant (§13 Always). Read back provider state: a
	// successor checkout is permitted only against a verified-detaching predecessor
	// (PDEC-11), never by inferring that a subscription has stopped billing.
	const existingRef = context.plan?.gateway_subscription_id
	if (existingRef && context.plan && context.plan.gateway !== "none") {
		try {
			const state = await gatewayForRail(context.plan.gateway as Rail).getSubscriptionState(existingRef)
			if (isLiveNonDetaching(state)) {
				return NextResponse.json(
					{
						error: "This workspace already has an active subscription. Change or cancel it before checking out again.",
						code: "subscription_exists",
					},
					{ status: 409 },
				)
			}
		} catch (err) {
			// Cannot verify → fail closed rather than risk double-billing.
			console.error("[billing/checkout] subscription read-back failed:", err)
			return NextResponse.json(
				{
					error: "Could not verify the existing subscription state; refusing to start a second subscription.",
					code: "subscription_state_unverified",
				},
				{ status: 503 },
			)
		}
	}

	// Founding cohort is locked to persisted server state, never the request body (§15).
	const isFounding = context.plan?.is_founding === true

	try {
		const session = await gatewayForCurrency(currency).createCheckout({
			workspaceId: context.workspaceId,
			tier,
			cycle,
			currency,
			isFounding,
			seats,
		})
		return NextResponse.json({ checkoutUrl: session.checkoutUrl, opaqueRef: session.opaqueRef })
	} catch (err) {
		if (err instanceof TierUnavailableError) {
			return NextResponse.json(
				{ error: err.message, code: "tier_unavailable", requiredCurrency: TEAM_REQUIRED_CURRENCY },
				{ status: 400 },
			)
		}
		console.error("[billing/checkout] createCheckout failed:", err)
		return NextResponse.json({ error: "Could not start checkout. Please try again.", code: "checkout_failed" }, { status: 502 })
	}
}
