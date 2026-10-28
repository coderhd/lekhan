/**
 * T12 — scheduled plan change (PDEC-12, US-5).
 *
 * Mutates the EXISTING subscription rather than creating a second one. Stripe's
 * mechanism is the Billing Portal (subscription-update enabled), so on the Stripe
 * rail this route deliberately refuses with `portal_required` and the UI opens
 * `/api/billing/portal` instead. Razorpay has no portal, so its scheduled-change
 * API is the mechanism: PATCH the subscription and report the provider's
 * effective date.
 *
 * The request carries only an opaque `{ tier, cycle }`; seats/cohort/price are
 * resolved server-side from the stored workspace row.
 */

import { NextRequest, NextResponse } from "next/server"
import { isBillingCycle, isBillingTier, TierUnavailableError, type Rail } from "@/lib/billing/gateway"
import { gatewayForRail } from "@/lib/billing/gateway-factory"
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
	const { tier, cycle } = input
	if (!isBillingTier(tier) || !isBillingCycle(cycle)) {
		return NextResponse.json(
			{ error: "tier and cycle are required and must be valid.", code: "invalid_plan_change" },
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

	const plan = context.plan
	if (!plan || plan.gateway === "none" || !plan.gateway_subscription_id) {
		return NextResponse.json(
			{ error: "No active subscription to change.", code: "no_subscription" },
			{ status: 400 },
		)
	}

	if (plan.gateway === "stripe") {
		return NextResponse.json(
			{
				error: "Stripe plan changes are completed in the Billing Portal.",
				code: "portal_required",
			},
			{ status: 409 },
		)
	}

	if (tier === "team" && plan.currency !== "USD") {
		return NextResponse.json(
			{ error: "Team is USD-only at launch.", code: "tier_unavailable" },
			{ status: 400 },
		)
	}

	try {
		const result = await gatewayForRail(plan.gateway as Rail).schedulePlanChange({
			subscriptionRef: plan.gateway_subscription_id,
			tier,
			cycle,
			seats,
		})
		return NextResponse.json({
			tier: result.tier,
			cycle: result.cycle,
			effectiveAt: result.effectiveAt,
			scheduledChangeRef: result.scheduledChangeRef,
		})
	} catch (err) {
		if (err instanceof TierUnavailableError) {
			return NextResponse.json({ error: err.message, code: "tier_unavailable" }, { status: 400 })
		}
		console.error("[billing/plan-change] schedulePlanChange failed:", err)
		return NextResponse.json(
			{ error: "Could not schedule the plan change. Please try again.", code: "plan_change_failed" },
			{ status: 502 },
		)
	}
}
