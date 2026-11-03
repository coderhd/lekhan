/**
 * T5 — currency-agnostic cancel wrapper.
 *
 * Cancels at period end on the stored rail (both rails share `cancelAtPeriodEnd`);
 * nothing is ever deleted, and the paid remainder stays honored until the
 * provider-reported period end (spec §15 cancellation safety).
 */

import { NextRequest, NextResponse } from "next/server"
import type { Rail } from "@/lib/billing/gateway"
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
			{ error: "No active subscription on this workspace.", code: "no_subscription" },
			{ status: 400 },
		)
	}

	try {
		await gatewayForRail(plan.gateway as Rail).cancelAtPeriodEnd(plan.gateway_subscription_id)
	} catch (err) {
		console.error("[billing/cancel] cancelAtPeriodEnd failed:", err)
		return NextResponse.json({ error: "Could not cancel the subscription. Please try again.", code: "cancel_failed" }, { status: 502 })
	}

	// SIL-56 R-CANCEL-FLAG: the stored flag records OUR provider-acknowledged cancel
	// instruction. Razorpay never echoes it, so the checkout gate depends on this
	// write to treat the subscription as detaching; Stripe's read-back stays the
	// authority and converges the mirror. A failed write must not lose the provider
	// action — log loudly and let reconciliation/webhooks converge the column.
	const { error: flagError } = await admin
		.from("workspace_plans")
		.update({ cancel_at_period_end: true })
		.eq("workspace_id", context.workspaceId)
	if (flagError) {
		console.error("[billing/cancel] provider cancel succeeded but cancel_at_period_end mirror write failed:", flagError)
	}

	return NextResponse.json({ ok: true })
}
