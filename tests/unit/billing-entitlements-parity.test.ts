import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * T11 — entitlement cutover parity (plan T11; spec §4/§6/§7; US-7 / D9).
 *
 * Pins:
 *  - dual-read parity: for canonical tiers the backfilled workspace row and the
 *    deprecated `profiles.plan` mirror yield identical enforcement;
 *  - Review Focus 5: legacy tokens (`go`, `enterprise`, unknown) can never reach
 *    `getPlanLimits` unnormalized, and the T8 mirror write path emits only
 *    `free|plus|pro|team`;
 *  - D9 grace: `past_due` stays fully entitled for 7 days, then the relay is
 *    read-only (the row's grace anchor is authoritative);
 *  - downgrades never touch content (no deletion path in entitlements).
 */

// ---------------------------------------------------------------------------
// Supabase double (only the reads getOwnerEntitlement uses)
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
	rows: {} as Record<string, Array<Record<string, unknown>>>,
	errors: {} as Record<string, { message: string } | null>,
}))

vi.mock("@/lib/supabase", () => {
	const chain = (table: string) => {
		const filters: Array<(row: Record<string, unknown>) => boolean> = []
		const builder = {
			select: () => builder,
			eq: (column: string, value: unknown) => {
				filters.push((row) => row[column] === value)
				return builder
			},
			maybeSingle: async () => {
				if (state.errors[table]) return { data: null, error: state.errors[table] }
				const rows = (state.rows[table] ?? []).filter((row) => filters.every((f) => f(row)))
				return { data: rows[0] ?? null, error: null }
			},
		}
		return builder
	}
	return { supabase: { from: (table: string) => chain(table) } }
})

import { getPlanLimits } from "@/lib/tier-limits"
import { normalizeLegacyPlan } from "@/lib/billing/legacy-plan-normalization"
import {
	BILLING_GRACE_PERIOD_DAYS,
	entitlementFromRow,
	resolveOwnerWorkspaceEntitlement,
	resolveWorkspaceEntitlement,
} from "@/lib/billing/entitlements"
import { getOwnerEntitlement } from "@/services/db"
import { applyEntitlementFromReadBack } from "@/services/billing/webhook-processor"
import {
	asSupabaseClient,
	fakeDb,
	readBackReturning,
	seedStore,
	SUB,
	WS,
	type Store,
} from "./billing-webhook-testkit"

const OWNER = "22222222-2222-4222-8222-222222222222"

function seed(profilePlan: string | null, plan: Record<string, unknown> | null) {
	state.rows = {
		workspaces: plan === null ? [] : [{ id: WS, owner_id: OWNER }],
		workspace_plans: plan === null ? [] : [{ workspace_id: WS, status: "none", ...plan }],
		profiles: profilePlan === null ? [] : [{ id: OWNER, plan: profilePlan }],
	}
	state.errors = {}
}

function capabilityOf(tier: string, seats?: number | null) {
	return getPlanLimits(tier, seats).maxDistinctCollaborators
}

beforeEach(() => {
	seed(null, null)
})

// ---------------------------------------------------------------------------
// Dual-read parity
// ---------------------------------------------------------------------------

describe("entitlement cutover — dual-read parity", () => {
	it.each([
		["free", {}],
		["plus", {}],
		["pro", {}],
		["team", { seats: null }],
	])("canonical %s: workspace row and mirror enforce equally", async (profilePlan, extra) => {
		seed(profilePlan, { tier: profilePlan, status: "active", ...extra })

		const entitlement = await getOwnerEntitlement(OWNER)
		expect(entitlement.source).toBe("workspace")
		expect(entitlement.tier).toBe(profilePlan)

		const cutoverLimit = capabilityOf(entitlement.tier, entitlement.seats)
		const preCutoverLimit = capabilityOf(normalizeLegacyPlan(profilePlan))
		expect(cutoverLimit).toBe(preCutoverLimit)
	})

	it("resolves a Team workspace from its own seat count (owner excluded)", async () => {
		seed("team", { tier: "team", status: "active", seats: 7 })
		const entitlement = await getOwnerEntitlement(OWNER)
		expect(entitlement.seats).toBe(7)
		expect(capabilityOf(entitlement.tier, entitlement.seats)).toBe(7)
	})

	it("never reads profiles.plan while the workspace row is readable", async () => {
		const from = vi.fn((table: string) => {
			const rows = state.rows[table] ?? []
			const builder = {
				select: () => builder,
				eq: () => builder,
				maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
			}
			return builder
		})
		state.rows = {
			workspaces: [{ id: WS, owner_id: OWNER }],
			workspace_plans: [{ workspace_id: WS, tier: "pro", status: "active" }],
			profiles: [{ id: OWNER, plan: "free" }],
		}
		const entitlement = await resolveOwnerWorkspaceEntitlement(OWNER, { from } as never)
		expect(entitlement?.tier).toBe("pro")
		expect(from).not.toHaveBeenCalledWith("profiles")
	})
})

// ---------------------------------------------------------------------------
// Review Focus 5 — legacy token leak guard
// ---------------------------------------------------------------------------

describe("entitlement cutover — legacy tokens never leak into enforcement", () => {
	it("normalizes the mirror fallback instead of silently serving FREE_LIMITS", async () => {
		// Invitee accept paths cannot read the owner's workspace row under RLS; the
		// normalized mirror keeps `go` as Plus rather than the old silent free cap.
		seed("go", null)
		const entitlement = await getOwnerEntitlement(OWNER)
		expect(entitlement.source).toBe("legacy-mirror")
		expect(entitlement.tier).toBe("plus")
		expect(capabilityOf(entitlement.tier, entitlement.seats)).toBe(10)
		expect(capabilityOf("go")).toBe(2) // the pre-T11 behaviour the guard replaces
	})

	it("defaults to free only when neither source is readable", async () => {
		seed(null, null)
		const entitlement = await getOwnerEntitlement(OWNER)
		expect(entitlement).toEqual({ tier: "free", seats: null, source: "default", entitlement: null })
	})

	it("rejects a non-canonical workspace tier loudly (no silent downgrade)", () => {
		expect(() => entitlementFromRow({ workspace_id: WS, tier: "go" })).toThrow(/canonical enforcement tier/)
	})

	it("the T8 mirror write path can emit only normalized tiers", async () => {
		for (const tier of ["plus", "pro", "team"] as const) {
			const store: Store = seedStore({ plan: { tier: "free", status: "none" } })
			const outcome = await applyEntitlementFromReadBack(
				"stripe",
				{ db: asSupabaseClient(fakeDb(store)), now: () => new Date("2026-10-27T00:00:00.000Z") },
				await readBackReturning({ tier, status: "active" })(),
			)
			expect(["free", "plus", "pro", "team"]).toContain(outcome.mirrorPlan)
			expect(store.profiles?.[0]?.plan).toBe(outcome.mirrorPlan)
			expect(["go", "enterprise"]).not.toContain(store.profiles?.[0]?.plan)
		}

		// Legacy tokens may only enter through T2 normalization, whose output is
		// structurally canonical — never the raw `go`/`enterprise` token.
		for (const legacy of ["go", "Go ", "enterprise", "PRO", "team", "wat"]) {
			expect(["free", "plus", "pro", "team"]).toContain(normalizeLegacyPlan(legacy))
		}
	})
})

// ---------------------------------------------------------------------------
// D9 — past-due grace
// ---------------------------------------------------------------------------

describe("entitlement cutover — D9 past-due grace", () => {
	const base = { workspace_id: WS, tier: "pro", status: "past_due", current_period_end: null }

	it("stays fully entitled inside the 7-day window", () => {
		const now = new Date("2026-10-27T12:00:00.000Z")
		const pastDueSince = new Date(now.getTime() - (BILLING_GRACE_PERIOD_DAYS - 1) * 86_400_000).toISOString()
		const entitlement = entitlementFromRow({ ...base, past_due_since: pastDueSince }, { now })
		expect(entitlement.inGracePeriod).toBe(true)
		expect(entitlement.relayReadOnly).toBe(false)
		expect(entitlement.tier).toBe("pro")
		expect(entitlement.graceExpiresAt).not.toBeNull()
	})

	it("turns read-only at the exact grace boundary (inclusive expiry)", () => {
		const now = new Date("2026-10-27T12:00:00.000Z")
		const pastDueSince = new Date(now.getTime() - BILLING_GRACE_PERIOD_DAYS * 86_400_000).toISOString()
		const entitlement = entitlementFromRow({ ...base, past_due_since: pastDueSince }, { now })
		expect(entitlement.inGracePeriod).toBe(false)
		expect(entitlement.relayReadOnly).toBe(true)
		// Grace expiry never downgrades the tier: content/history stay intact.
		expect(entitlement.tier).toBe("pro")
	})

	it("fails closed to read-only when a past_due row has no grace anchor", () => {
		const entitlement = entitlementFromRow({ ...base, past_due_since: null })
		expect(entitlement.inGracePeriod).toBe(false)
		expect(entitlement.relayReadOnly).toBe(true)
	})

	it("active/canceled workspaces are not forced read-only by the grace gate", () => {
		expect(entitlementFromRow({ ...base, status: "active" }).relayReadOnly).toBe(false)
		expect(entitlementFromRow({ ...base, status: "canceled", tier: "free" }).relayReadOnly).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// Downgrades keep content
// ---------------------------------------------------------------------------

describe("entitlement cutover — downgrades keep content", () => {
	it("a terminal downgrade converges the plan to free without deleting content", async () => {
		const store = seedStore({
			plan: {
				tier: "pro",
				status: "active",
				gateway: "stripe",
				gateway_subscription_id: SUB,
				current_period_end: "2026-11-01T00:00:00.000Z",
			},
		})
		store.pages = [{ id: "page-1", owner_id: OWNER, title: "Kept" }]
		store.documents = [{ id: "doc-1", owner_id: OWNER, title: "Kept" }]

		const outcome = await applyEntitlementFromReadBack(
			"stripe",
			{ db: asSupabaseClient(fakeDb(store)), now: () => new Date("2026-10-27T00:00:00.000Z") },
			await readBackReturning({ status: "canceled", tier: null, cycle: null })(),
		)

		expect(outcome.terminal).toBe(true)
		expect(store.workspace_plans?.[0]?.tier).toBe("free")
		expect(store.pages).toEqual([{ id: "page-1", owner_id: OWNER, title: "Kept" }])
		expect(store.documents).toEqual([{ id: "doc-1", owner_id: OWNER, title: "Kept" }])
	})

	it("the entitlement resolver has no deletion path", async () => {
		const source = readFileSync(path.join(process.cwd(), "lib/billing/entitlements.ts"), "utf8")
		expect(source).not.toMatch(/\.delete\s*\(/)
		expect(source).not.toMatch(/deletePage|deleteDocument|deleteWorkspace/)
	})
})

// ---------------------------------------------------------------------------
// Resolution errors
// ---------------------------------------------------------------------------

describe("entitlement cutover — resolution errors propagate", () => {
	it("surfaces workspace_plans read failures instead of guessing a tier", async () => {
		seed("free", null)
		const client = {
			from: (table: string) => {
				const builder = {
					select: () => builder,
					eq: () => builder,
					maybeSingle: async () =>
						table === "workspace_plans"
							? { data: null, error: { message: "boom" } }
							: { data: { id: WS }, error: null },
				}
				return builder
			},
		}
		await expect(resolveWorkspaceEntitlement(WS, client as never)).rejects.toThrow(/workspace_plans read failed/)
	})
})
