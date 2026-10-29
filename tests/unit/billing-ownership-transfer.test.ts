import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/billing/gateway-factory", () => ({
	gatewayForRail: vi.fn(),
}))

import { gatewayForRail } from "@/lib/billing/gateway-factory"
import {
	acceptOwnershipTransfer,
	initiateOwnershipTransfer,
	issueTransferToken,
	OwnershipTransferError,
} from "@/services/billing/ownership-transfer"

const OWNER = "11111111-1111-4111-8111-111111111111"
const SUCCESSOR = "22222222-2222-4222-8222-222222222222"
const WORKSPACE = "ws-1"
const SUB = "sub-1"

interface DbOptions {
	ownerId?: string
	successorExists?: boolean
	successorOwnsWorkspace?: boolean
	plan?: Record<string, unknown> | null
	ownerUpdateRows?: Array<{ id: string }> | null
	ownerUpdateError?: { message: string; code?: string } | null
	flagUpdateError?: { message: string; code?: string } | null
}

function makeDb(options: DbOptions = {}) {
	const {
		ownerId = OWNER,
		successorExists = true,
		successorOwnsWorkspace = false,
		plan = {
			gateway: "stripe",
			gateway_subscription_id: SUB,
			cancel_at_period_end: false,
			tier: "pro",
		},
		ownerUpdateRows = [{ id: WORKSPACE }],
		ownerUpdateError = null,
		flagUpdateError = null,
	} = options

	const updates: Array<{ table: string; values: Record<string, unknown> }> = []

	const db = {
		from(table: string) {
			const filters: Record<string, unknown> = {}
			let operation: "select" | "update" = "select"
			let values: Record<string, unknown> = {}

			const resolve = () => {
				if (operation === "update") {
					updates.push({ table, values })
					if (table === "workspace_plans") {
						return { data: null, error: flagUpdateError }
					}
					return { data: ownerUpdateRows, error: ownerUpdateError }
				}
				if (table === "workspaces" && "id" in filters) {
					return { data: ownerId ? { id: String(filters.id), owner_id: ownerId } : null, error: null }
				}
				if (table === "workspaces" && "owner_id" in filters) {
					return { data: successorOwnsWorkspace ? { id: "ws-successor" } : null, error: null }
				}
				if (table === "profiles") {
					return { data: successorExists ? { id: filters.id } : null, error: null }
				}
				if (table === "workspace_plans") {
					return { data: plan, error: null }
				}
				return { data: null, error: null }
			}

			const chain: Record<string, unknown> = {
				select: () => chain,
				update: (next: Record<string, unknown>) => {
					operation = "update"
					values = next
					return chain
				},
				eq: (key: string, value: unknown) => {
					filters[key] = value
					return chain
				},
				maybeSingle: async () => resolve(),
				then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
					Promise.resolve(resolve()).then(onFulfilled, onRejected),
			}
			return chain
		},
	}

	return { db: db as never, updates }
}

function gateway(state: {
	status?: "active" | "past_due" | "canceled"
	cancelAtPeriodEnd?: boolean
}) {
	const getSubscriptionState = vi.fn()
	const cancelAtPeriodEnd = vi.fn().mockResolvedValue(undefined)
	getSubscriptionState.mockResolvedValue({
		subscriptionRef: SUB,
		status: state.status ?? "active",
		cancelAtPeriodEnd: state.cancelAtPeriodEnd ?? false,
		currentPeriodEnd: "2026-12-01T00:00:00.000Z",
	})
	vi.mocked(gatewayForRail).mockReturnValue({ getSubscriptionState, cancelAtPeriodEnd } as never)
	return { getSubscriptionState, cancelAtPeriodEnd }
}

function tokenFor(overrides: Partial<{ fromUserId: string; toUserId: string; workspaceId: string }> = {}, ttl = 60_000) {
	return issueTransferToken(
		{
			workspaceId: overrides.workspaceId ?? WORKSPACE,
			fromUserId: overrides.fromUserId ?? OWNER,
			toUserId: overrides.toUserId ?? SUCCESSOR,
		},
		ttl,
	).token
}

beforeEach(() => {
	vi.clearAllMocks()
	process.env.BILLING_TRANSFER_TOKEN_SECRET = "test-transfer-secret-at-least-16"
})

describe("initiateOwnershipTransfer (T13 / PDEC-11)", () => {
	it("stops a live Stripe subscription and verifies the detach by read-back", async () => {
		const { db } = makeDb()
		const g = gateway({})
		// first read: live; after cancel: provider echoes cancel_at_period_end.
		g.getSubscriptionState
			.mockResolvedValueOnce({ subscriptionRef: SUB, status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null })
			.mockResolvedValueOnce({ subscriptionRef: SUB, status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: null })

		const result = await initiateOwnershipTransfer(db, {
			workspaceId: WORKSPACE,
			actingUserId: OWNER,
			successorUserId: SUCCESSOR,
		})

		expect(g.cancelAtPeriodEnd).toHaveBeenCalledWith(SUB)
		expect(g.getSubscriptionState).toHaveBeenCalledTimes(2)
		expect(result.outgoingSubscription).toBe("detaching")
		expect(result.token.split(".")).toHaveLength(2)
	})

	it("fails closed when the provider will not confirm the Stripe detach", async () => {
		const { db } = makeDb()
		const g = gateway({})
		// Stays live after the cancel call — never infer success from the 2xx.
		g.getSubscriptionState.mockResolvedValue({
			subscriptionRef: SUB,
			status: "active",
			cancelAtPeriodEnd: false,
			currentPeriodEnd: null,
		})

		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: OWNER,
				successorUserId: SUCCESSOR,
			}),
		).rejects.toMatchObject({ code: "detach_unverified", status: 502 })
	})

	it("records the accepted cancel instruction on the Razorpay rail (SIL-56 provenance)", async () => {
		const { db, updates } = makeDb({
			plan: { gateway: "razorpay", gateway_subscription_id: SUB, cancel_at_period_end: false, tier: "plus" },
		})
		const g = gateway({})
		g.getSubscriptionState.mockResolvedValue({
			subscriptionRef: SUB,
			status: "active",
			cancelAtPeriodEnd: false, // provider never echoes it
			currentPeriodEnd: null,
		})

		const result = await initiateOwnershipTransfer(db, {
			workspaceId: WORKSPACE,
			actingUserId: OWNER,
			successorUserId: SUCCESSOR,
		})

		expect(g.cancelAtPeriodEnd).toHaveBeenCalledWith(SUB)
		expect(updates).toContainEqual({
			table: "workspace_plans",
			values: { cancel_at_period_end: true },
		})
		expect(result.outgoingSubscription).toBe("detaching")
	})

	it("does not mutate ownership at initiation (no silent takeover)", async () => {
		const { db, updates } = makeDb({
			plan: { gateway: "none", gateway_subscription_id: null, cancel_at_period_end: null, tier: "free" },
		})

		await initiateOwnershipTransfer(db, {
			workspaceId: WORKSPACE,
			actingUserId: OWNER,
			successorUserId: SUCCESSOR,
		})

		expect(updates).toEqual([])
	})

	it("fails before any provider call when the HMAC secret is not configured", async () => {
		delete process.env.BILLING_TRANSFER_TOKEN_SECRET
		const { db, updates } = makeDb()
		const g = gateway({})

		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: OWNER,
				successorUserId: SUCCESSOR,
			}),
		).rejects.toMatchObject({ code: "transfer_not_configured", status: 503 })
		// Never cancel a live subscription and then discover the token cannot be minted.
		expect(g.cancelAtPeriodEnd).not.toHaveBeenCalled()
		expect(updates).toEqual([])
	})

	it("rejects a non-UUID successor id", async () => {
		const { db } = makeDb()
		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: OWNER,
				successorUserId: "not-a-uuid",
			}),
		).rejects.toMatchObject({ code: "successor_not_found", status: 404 })
	})

	it("rejects a non-owner initiator", async () => {
		const { db } = makeDb()
		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: "intruder",
				successorUserId: SUCCESSOR,
			}),
		).rejects.toMatchObject({ code: "not_workspace_owner", status: 403 })
	})

	it("rejects a successor who already owns a workspace (UNIQUE owner_id)", async () => {
		const { db } = makeDb({ successorOwnsWorkspace: true })
		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: OWNER,
				successorUserId: SUCCESSOR,
			}),
		).rejects.toMatchObject({ code: "successor_owns_workspace", status: 409 })
	})

	it("rejects a successor without an account", async () => {
		const { db } = makeDb({ successorExists: false })
		await expect(
			initiateOwnershipTransfer(db, {
				workspaceId: WORKSPACE,
				actingUserId: OWNER,
				successorUserId: SUCCESSOR,
			}),
		).rejects.toMatchObject({ code: "successor_not_found", status: 404 })
	})
})

describe("acceptOwnershipTransfer (T13)", () => {
	it("performs an atomic conditional owner swap and keeps the plan", async () => {
		const { db, updates } = makeDb()
		gateway({ cancelAtPeriodEnd: true })

		const result = await acceptOwnershipTransfer(db, {
			token: tokenFor(),
			actingUserId: SUCCESSOR,
		})

		expect(updates).toContainEqual({ table: "workspaces", values: { owner_id: SUCCESSOR } })
		// Predecessor payment identity must not follow the subscription.
		expect(updates).toContainEqual({ table: "workspace_plans", values: { gateway_customer_id: null } })
		expect(result).toMatchObject({
			workspaceId: WORKSPACE,
			previousOwnerId: OWNER,
			ownerId: SUCCESSOR,
			planPreserved: true,
			tier: "pro",
		})
	})

	it("rejects acceptance while the predecessor is still billing (no double-charge window)", async () => {
		const { db, updates } = makeDb()
		gateway({ cancelAtPeriodEnd: false }) // still live

		await expect(
			acceptOwnershipTransfer(db, { token: tokenFor(), actingUserId: SUCCESSOR }),
		).rejects.toMatchObject({ code: "subscription_not_detached", status: 409 })
		expect(updates).toEqual([])
	})

	it("rejects a replay/race when the conditional update matches no row", async () => {
		const { db } = makeDb({ ownerUpdateRows: [] })
		gateway({ cancelAtPeriodEnd: true })

		await expect(
			acceptOwnershipTransfer(db, { token: tokenFor(), actingUserId: SUCCESSOR }),
		).rejects.toMatchObject({ code: "transfer_conflict", status: 409 })
	})

	it("maps a UNIQUE owner conflict to a clear 409 (one workspace per user at H0)", async () => {
		const { db } = makeDb({ ownerUpdateError: { message: "duplicate key", code: "23505" } })
		gateway({ cancelAtPeriodEnd: true })

		await expect(
			acceptOwnershipTransfer(db, { token: tokenFor(), actingUserId: SUCCESSOR }),
		).rejects.toMatchObject({ code: "successor_owns_workspace", status: 409 })
	})

	it("rejects the wrong recipient", async () => {
		const { db } = makeDb()
		gateway({ cancelAtPeriodEnd: true })

		await expect(
			acceptOwnershipTransfer(db, { token: tokenFor(), actingUserId: "someone-else" }),
		).rejects.toMatchObject({ code: "wrong_recipient", status: 403 })
	})

	it("rejects a tampered or expired token", async () => {
		const { db } = makeDb()
		gateway({ cancelAtPeriodEnd: true })

		await expect(
			acceptOwnershipTransfer(db, { token: `${tokenFor()}x`, actingUserId: SUCCESSOR }),
		).rejects.toBeInstanceOf(OwnershipTransferError)

		await expect(
			acceptOwnershipTransfer(db, { token: tokenFor({}, -1000), actingUserId: SUCCESSOR }),
		).rejects.toMatchObject({ code: "token_expired", status: 410 })
	})

	it("fails closed when transfer tokens are not configured", async () => {
		delete process.env.BILLING_TRANSFER_TOKEN_SECRET
		const { db } = makeDb()

		await expect(
			acceptOwnershipTransfer(db, { token: "anything.sig", actingUserId: SUCCESSOR }),
		).rejects.toMatchObject({ code: "transfer_not_configured", status: 503 })
	})
})
