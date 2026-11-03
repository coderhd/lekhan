/**
 * T13 — ownership transfer route (TL A6, US-8/PDEC-11).
 *
 * Two explicit actions so there is no silent takeover:
 *  - `{ action: "initiate", successorUserId }` — owner-only; verifies and stops
 *    the outgoing auto-billing, returns a signed successor token.
 *  - `{ action: "accept", token }` — the signed-in successor completes the swap.
 *
 * The requester's workspace is resolved from their own session (`owner_id =
 * requester`), never from a client-supplied workspace id.
 */

import { NextRequest, NextResponse } from "next/server"
import {
	acceptOwnershipTransfer,
	initiateOwnershipTransfer,
	OwnershipTransferError,
} from "@/services/billing/ownership-transfer"
import {
	billingContextErrorResponse,
	createBillingAdminClient,
	getRequestUserId,
	resolveOwnerBilling,
} from "@/lib/billing/workspace-billing"

function transferErrorResponse(err: unknown): NextResponse {
	if (err instanceof OwnershipTransferError) {
		return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
	}
	console.error("[billing/transfer] unexpected failure:", err)
	return NextResponse.json({ error: "Ownership transfer failed.", code: "transfer_failed" }, { status: 500 })
}

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
	const admin = createBillingAdminClient()

	if (input.action === "initiate") {
		const successorUserId = typeof input.successorUserId === "string" ? input.successorUserId.trim() : ""
		if (!successorUserId) {
			return NextResponse.json(
				{ error: "successorUserId is required.", code: "invalid_transfer_request" },
				{ status: 400 },
			)
		}

		let context
		try {
			context = await resolveOwnerBilling(admin, userId)
		} catch (err) {
			return billingContextErrorResponse(err)
		}

		try {
			const result = await initiateOwnershipTransfer(admin, {
				workspaceId: context.workspaceId,
				actingUserId: userId,
				successorUserId,
			})
			return NextResponse.json({
				token: result.token,
				expiresAt: result.expiresAt,
				outgoingSubscription: result.outgoingSubscription,
				acceptPath: `/settings?transfer=${encodeURIComponent(result.token)}`,
			})
		} catch (err) {
			return transferErrorResponse(err)
		}
	}

	if (input.action === "accept") {
		const token = typeof input.token === "string" ? input.token.trim() : ""
		if (!token) {
			return NextResponse.json(
				{ error: "token is required.", code: "invalid_transfer_request" },
				{ status: 400 },
			)
		}

		try {
			const result = await acceptOwnershipTransfer(admin, { token, actingUserId: userId })
			return NextResponse.json(result)
		} catch (err) {
			return transferErrorResponse(err)
		}
	}

	return NextResponse.json(
		{ error: 'action must be "initiate" or "accept".', code: "invalid_transfer_request" },
		{ status: 400 },
	)
}
