/**
 * T5 — currency-agnostic portal wrapper.
 *
 * Stripe = Billing Portal session; Razorpay = hosted card-update payment-page link
 * (PDEC-1: there is no Razorpay portal session). The rail comes from the stored
 * `workspace_plans.gateway`, never the client.
 *
 * SIL-56 escalation-1 ruling: the portal lookup key is RAIL-SPECIFIC — Stripe takes
 * the stored customer id; Razorpay takes the stored SUBSCRIPTION ref, from which the
 * rail resolves the hosted `short_url` via live provider read-back. A missing
 * ref fails closed; the route never guesses a link (PDEC-1 "read-back, never inferred").
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
	const rail = plan && plan.gateway !== "none" ? (plan.gateway as Rail) : null
	// Rail-specific portal ref (see module note): razorpay rides the subscription,
	// stripe rides the customer. T8 persists both refs from authenticated state only.
	const portalRef = rail === "razorpay" ? plan?.gateway_subscription_id : plan?.gateway_customer_id
	if (!plan || !rail || !portalRef) {
		return NextResponse.json(
			{ error: "No billing account on this workspace yet.", code: "no_billing_account" },
			{ status: 400 },
		)
	}

	try {
		const session = await gatewayForRail(rail).portalUrl(portalRef)
		return NextResponse.json({ url: session.url, kind: session.kind })
	} catch (err) {
		console.error("[billing/portal] portalUrl failed:", err)
		return NextResponse.json({ error: "Could not open the billing portal. Please try again.", code: "portal_failed" }, { status: 502 })
	}
}
