import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/billing/workspace-billing", () => ({
	getRequestUserId: vi.fn(),
	createBillingAdminClient: vi.fn(() => ({})),
	resolveOwnerBilling: vi.fn(),
	billingContextErrorResponse: vi.fn(() => new Response("context", { status: 500 })),
}))

vi.mock("@/services/billing/ownership-transfer", () => ({
	initiateOwnershipTransfer: vi.fn(),
	acceptOwnershipTransfer: vi.fn(),
	OwnershipTransferError: class OwnershipTransferError extends Error {
		readonly code: string
		readonly status: number
		constructor(code: string, message: string, status = 400) {
			super(message)
			this.name = "OwnershipTransferError"
			this.code = code
			this.status = status
		}
	},
}))

import { POST } from "@/app/api/billing/transfer/route"
import { acceptOwnershipTransfer, initiateOwnershipTransfer, OwnershipTransferError } from "@/services/billing/ownership-transfer"
import { getRequestUserId, resolveOwnerBilling } from "@/lib/billing/workspace-billing"

const OWNER = "11111111-1111-4111-8111-111111111111"
const SUCCESSOR = "22222222-2222-4222-8222-222222222222"

function request(body: unknown) {
	return new NextRequest("http://localhost/api/billing/transfer", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
		body: JSON.stringify(body),
	})
}

describe("POST /api/billing/transfer (T13)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getRequestUserId).mockResolvedValue(OWNER)
		vi.mocked(resolveOwnerBilling).mockResolvedValue({ workspaceId: "ws-1", plan: null })
	})

	it("rejects an unauthenticated caller", async () => {
		vi.mocked(getRequestUserId).mockResolvedValue(null)
		expect((await POST(request({ action: "initiate", successorUserId: SUCCESSOR }))).status).toBe(401)
	})

	it("rejects an unknown action", async () => {
		expect((await POST(request({ action: "steal" }))).status).toBe(400)
	})

	it("resolves the workspace from the session, never the body", async () => {
		vi.mocked(initiateOwnershipTransfer).mockResolvedValue({
			token: "tok",
			expiresAt: "2026-11-01T00:00:00.000Z",
			outgoingSubscription: "detaching",
		})
		const res = await POST(request({ action: "initiate", successorUserId: SUCCESSOR, workspaceId: "attacker-ws" }))
		expect(res.status).toBe(200)
		expect(initiateOwnershipTransfer).toHaveBeenCalledWith(expect.anything(), {
			workspaceId: "ws-1",
			actingUserId: OWNER,
			successorUserId: SUCCESSOR,
		})
	})

	it("maps transfer errors to their status and code", async () => {
		vi.mocked(acceptOwnershipTransfer).mockRejectedValue(
			new OwnershipTransferError("subscription_not_detached", "still billing", 409),
		)
		const res = await POST(request({ action: "accept", token: "tok" }))
		expect(res.status).toBe(409)
		expect(await res.json()).toMatchObject({ code: "subscription_not_detached" })
	})

	it("returns the accept path for the successor", async () => {
		vi.mocked(initiateOwnershipTransfer).mockResolvedValue({
			token: "signed",
			expiresAt: "2026-11-01T00:00:00.000Z",
			outgoingSubscription: "none",
		})
		const data = await (await POST(request({ action: "initiate", successorUserId: SUCCESSOR }))).json()
		expect(data.acceptPath).toBe("/settings?transfer=signed")
	})
})
