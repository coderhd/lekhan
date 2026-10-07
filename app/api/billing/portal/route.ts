/**
 * T5 — currency-agnostic portal wrapper.
 *
 * Stripe = Billing Portal session; Razorpay = hosted card-update payment-page link
 * (PDEC-1: there is no Razorpay portal session). The rail comes from the stored
 * `workspace_plans.gateway`, never the client.
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
	if (!plan || plan.gateway === "none" || !plan.gateway_customer_id) {
		return NextResponse.json(
			{ error: "No billing account on this workspace yet.", code: "no_billing_account" },
			{ status: 400 },
		)
	}

	try {
		const session = await gatewayForRail(plan.gateway as Rail).portalUrl(plan.gateway_customer_id)
		return NextResponse.json({ url: session.url, kind: session.kind })
	} catch (err) {
		console.error("[billing/portal] portalUrl failed:", err)
		return NextResponse.json({ error: "Could not open the billing portal. Please try again.", code: "portal_failed" }, { status: 502 })
	}
}
