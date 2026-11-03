/**
 * T12 — billing summary for the settings UI.
 *
 * One owner-scoped read so the client never has to stitch together RLS reads or
 * import the server-only referral service. Everything returned is the owner's
 * own workspace state: entitlement projection + referral ledger summary.
 *
 * The referral ledger is read with the service-role client because the T9
 * service is server-only; the route is authenticated and resolves the workspace
 * by `owner_id = requester`, so a caller can only ever see their own row.
 */

import { NextRequest, NextResponse } from "next/server"
import { entitlementFromRow } from "@/lib/billing/entitlements"
import { getReferralSummary, ReferralLedgerError } from "@/services/billing/referral-credits"
import {
	billingContextErrorResponse,
	createBillingAdminClient,
	getRequestUserId,
	resolveOwnerBilling,
} from "@/lib/billing/workspace-billing"

export async function GET(request: NextRequest): Promise<NextResponse> {
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

	let entitlement = null
	if (context.plan) {
		try {
			entitlement = entitlementFromRow({
				...context.plan,
				workspace_id: context.workspaceId,
			})
		} catch (err) {
			// A non-canonical row is a loud fault; the UI must not render a made-up plan.
			console.error("[billing/summary] entitlement projection failed:", err)
			return NextResponse.json(
				{ error: "Billing state could not be read.", code: "entitlement_unreadable" },
				{ status: 500 },
			)
		}
	}

	try {
		const referral = await getReferralSummary(admin, context.workspaceId)
		return NextResponse.json({ workspaceId: context.workspaceId, entitlement, referral })
	} catch (err) {
		if (err instanceof ReferralLedgerError) {
			console.error("[billing/summary] referral summary failed:", err)
			// Entitlement is still valid; the referral card is decorative. Return the
			// plan state and let the UI hide the referral summary rather than 500.
			return NextResponse.json({ workspaceId: context.workspaceId, entitlement, referral: null })
		}
		throw err
	}
}
