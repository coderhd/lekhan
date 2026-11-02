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
	isCheckoutPending,
	isCurrency,
	isLiveNonDetaching,
	withStoredCancelFlag,
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

	// Checkout→activation gap (§13 Always): the row only learns the new
	// `gateway_subscription_id` when the activation webhook applies, so a second
	// checkout started while the first is still in flight would create a second
	// live subscription whose ref then overwrites the first — ghost billing that
	// reconciliation cannot see. Refuse while a checkout is pending.
	if (isCheckoutPending(context.plan)) {
		return NextResponse.json(
			{
				error: "A checkout is already in progress for this workspace. Finish it, or try again in a few minutes.",
				code: "checkout_in_progress",
			},
			{ status: 409 },
		)
	}

	// Single-live-subscription invariant (§13 Always). Read back provider state: a
	// successor checkout is permitted only against a verified-detaching predecessor
	// (PDEC-11), never by inferring that a subscription has stopped billing.
	const existingRef = context.plan?.gateway_subscription_id
	if (existingRef && context.plan && context.plan.gateway !== "none") {
		try {
			const state = await gatewayForRail(context.plan.gateway as Rail).getSubscriptionState(existingRef)
			// PDEC-11 transfer window (SIL-56 ruling): provider read-back is the SOLE source
			// of status; the stored `cancel_at_period_end` only softens `live` to `detaching`
			// on the RAZORPAY rail, where the provider never echoes the flag and the column
			// records our accepted cancel action. Stripe read-back is already authoritative —
			// a stale stored mirror can never open a double-charge window there.
			if (
				isLiveNonDetaching(
					withStoredCancelFlag(state, context.plan.gateway as Rail, context.plan.cancel_at_period_end),
				)
			) {
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
			// US-6 AC2: reuse the stored customer so a resubscribe does not mint a
			// second Stripe customer and strand any residual credit on it.
			customerRef: context.plan?.gateway_customer_id ?? null,
		})

		// Record the attempt so the gap above is closed. Best-effort: the session
		// already exists at the provider, and a write failure must not strand the
		// user — the read-back guard still covers the settled cases.
		const pending = await admin
			.from("workspace_plans")
			.update({
				checkout_pending_at: new Date().toISOString(),
				checkout_pending_ref: session.opaqueRef,
			})
			.eq("workspace_id", context.workspaceId)
		if (pending.error) {
			console.error("[billing/checkout] failed to record pending checkout:", pending.error)
		}

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
