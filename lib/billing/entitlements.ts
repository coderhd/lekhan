/**
 * T11 — entitlement resolution (spec §7/§8, plan T11; D9 grace).
 *
 * The billing root is the workspace (`workspace_plans.workspace_id`). Every
 * enforcement reader resolves the OWNER's workspace here instead of reading the
 * deprecated `profiles.plan` mirror directly. The consumer interfaces
 * (`getPlanLimits`, the relay gate) are unchanged — only the plan string's
 * source moves.
 *
 * Two layers:
 *  - `entitlementFromRow` / `resolveWorkspaceEntitlement` — read one
 *    `workspace_plans` row. The row is owner-readable via RLS, so this path is
 *    used directly by owner-scoped callers (settings UI in T12, the server relay
 *    with its service-role client).
 *  - `resolveOwnerWorkspaceEntitlement` — owner id → workspace id → row.
 *
 * Legacy plan tokens are NOT read here: `workspace_plans.tier` is CHECK
 * constrained to `free|plus|pro|team`. Any legacy `profiles.plan` read belongs
 * to the caller's dual-read fallback and must pass through
 * `normalizeLegacyPlan` (T2) before it reaches enforcement.
 *
 * D9 (payment failure): `past_due` keeps FULL entitlement through the 7-day
 * grace window anchored on `workspace_plans.past_due_since`. After expiry the
 * relay turns read-only (local data intact); the provider remains the source of
 * truth for the eventual terminal downgrade. The grace anchor is read from the
 * row, never derived from `gateway_events.processed_at`.
 *
 * This module is deliberately runtime-import-free: the sync relay requires it
 * from CommonJS (`server/auth.js`), and Node's TypeScript loader needs explicit
 * extensions for relative imports. Type-only imports are erased.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PlanTier } from "../tier-limits"

export type BillingCycle = "monthly" | "annual" | "none"
export type EntitlementStatus = "active" | "past_due" | "canceled" | "incomplete" | "none"
export type BillingGateway = "stripe" | "razorpay" | "none"

/** US-7 / D9: full features for seven days after the first failed payment. */
export const BILLING_GRACE_PERIOD_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
const CANONICAL_TIERS: ReadonlySet<string> = new Set(["free", "plus", "pro", "team"])
const BILLING_CYCLES: ReadonlySet<string> = new Set(["monthly", "annual", "none"])
const ENTITLEMENT_STATUSES: ReadonlySet<string> = new Set([
	"active",
	"past_due",
	"canceled",
	"incomplete",
	"none",
])
const GATEWAYS: ReadonlySet<string> = new Set(["stripe", "razorpay", "none"])

/** Columns read from `workspace_plans` (never `*` — billing refs stay out of callers). */
export const ENTITLEMENT_COLUMNS =
	"workspace_id, tier, billing_cycle, status, gateway, current_period_end, cancel_at_period_end, past_due_since, is_founding, seats"

export interface WorkspacePlanRowLike {
	workspace_id?: unknown
	tier?: unknown
	billing_cycle?: unknown
	status?: unknown
	gateway?: unknown
	current_period_end?: unknown
	cancel_at_period_end?: unknown
	past_due_since?: unknown
	is_founding?: unknown
	seats?: unknown
}

export interface WorkspaceEntitlement {
	workspaceId: string
	/** Canonical enforcement tier (never a legacy token). */
	tier: PlanTier
	billingCycle: BillingCycle
	status: EntitlementStatus
	gateway: BillingGateway
	currentPeriodEnd: string | null
	cancelAtPeriodEnd: boolean
	/** D9 grace anchor, written by the webhook processor / reconciliation. */
	pastDueSince: string | null
	isFounding: boolean
	/** Team seat count; owner excluded from the collaborator cap. */
	seats: number | null
	/** ISO timestamp when the D9 grace window closes (`null` outside past_due). */
	graceExpiresAt: string | null
	inGracePeriod: boolean
	/**
	 * True when the sync relay should accept the connection read-only. Only the
	 * D9 expiry path sets this: a failed payment is fully entitled through the
	 * grace window and read-only afterwards. Downgrades never delete content.
	 */
	relayReadOnly: boolean
}

export class EntitlementResolutionError extends Error {
	readonly stage: string

	constructor(stage: string, message: string) {
		super(message)
		this.name = "EntitlementResolutionError"
		this.stage = stage
	}
}

export interface EntitlementResolveOptions {
	/** Injectable clock (tests / deterministic callers). */
	now?: Date
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null
}

function parseTimestamp(value: unknown): number | null {
	const iso = asString(value)
	if (!iso) return null
	const ms = Date.parse(iso)
	return Number.isFinite(ms) ? ms : null
}

/**
 * Projects a `workspace_plans` row into enforcement state.
 *
 * A non-canonical tier is a loud fault, not a silent FREE_LIMITS downgrade
 * (Review Focus 5). The database CHECK makes this unreachable for real rows;
 * callers may fall back to the normalized legacy mirror when it does happen.
 */
export function entitlementFromRow(
	row: WorkspacePlanRowLike,
	options: EntitlementResolveOptions = {},
): WorkspaceEntitlement {
	const workspaceId = asString(row.workspace_id)
	if (!workspaceId) {
		throw new EntitlementResolutionError("workspace-binding", "workspace_plans row carries no workspace_id")
	}

	const tier = asString(row.tier) ?? "free"
	if (!CANONICAL_TIERS.has(tier)) {
		throw new EntitlementResolutionError(
			"tier",
			`workspace_plans.tier is not a canonical enforcement tier: ${tier}`,
		)
	}

	const status = (asString(row.status) ?? "none") as EntitlementStatus
	const billingCycle = (asString(row.billing_cycle) ?? "none") as BillingCycle
	const gateway = (asString(row.gateway) ?? "none") as BillingGateway
	const pastDueSince = asString(row.past_due_since)
	const nowMs = (options.now ?? new Date()).getTime()

	let graceExpiresAt: string | null = null
	let inGracePeriod = false
	if (status === "past_due") {
		const pastDueMs = parseTimestamp(pastDueSince)
		if (pastDueMs != null) {
			const graceMs = pastDueMs + BILLING_GRACE_PERIOD_DAYS * DAY_MS
			graceExpiresAt = new Date(graceMs).toISOString()
			inGracePeriod = nowMs < graceMs
		}
	}

	// D9: full features in grace, relay read-only after it. A past_due row
	// without an anchor cannot prove grace coverage — fail closed to read-only.
	const relayReadOnly =
		status === "past_due" ? !inGracePeriod : status === "incomplete" && tier !== "free"

	return {
		workspaceId,
		tier: tier as PlanTier,
		billingCycle: BILLING_CYCLES.has(billingCycle) ? billingCycle : "none",
		status: ENTITLEMENT_STATUSES.has(status) ? status : "none",
		gateway: GATEWAYS.has(gateway) ? gateway : "none",
		currentPeriodEnd: asString(row.current_period_end),
		cancelAtPeriodEnd: row.cancel_at_period_end === true,
		pastDueSince,
		isFounding: row.is_founding === true,
		seats: typeof row.seats === "number" && Number.isFinite(row.seats) ? row.seats : null,
		graceExpiresAt,
		inGracePeriod,
		relayReadOnly,
	}
}

/** Default browser/server client, resolved lazily so the relay can require this module. */
async function defaultClient(): Promise<SupabaseClient> {
	const mod = await import("../supabase")
	return mod.supabase as SupabaseClient
}

/**
 * Reads the workspace's entitlement row. The row is owner-readable via RLS;
 * query errors propagate (callers must not silently downgrade on a failed read).
 */
export async function resolveWorkspaceEntitlement(
	workspaceId: string,
	client?: SupabaseClient,
	options: EntitlementResolveOptions = {},
): Promise<WorkspaceEntitlement> {
	const db = client ?? (await defaultClient())
	const { data, error } = await db
		.from("workspace_plans")
		.select(ENTITLEMENT_COLUMNS)
		.eq("workspace_id", workspaceId)
		.maybeSingle()

	if (error) {
		throw new EntitlementResolutionError("plan-read", `workspace_plans read failed: ${error.message}`)
	}
	if (!data) {
		throw new EntitlementResolutionError("plan-missing", `no workspace_plans row for workspace ${workspaceId}`)
	}

	return entitlementFromRow(data as WorkspacePlanRowLike, options)
}

/**
 * Owner id → workspace id → `workspace_plans` row. Returns `null` when the
 * owner has no workspace yet (or RLS hides it, e.g. an invitee resolving the
 * page owner's plan); callers decide the fallback. Query errors propagate.
 */
export async function resolveOwnerWorkspaceEntitlement(
	ownerId: string,
	client?: SupabaseClient,
	options: EntitlementResolveOptions = {},
): Promise<WorkspaceEntitlement | null> {
	const db = client ?? (await defaultClient())
	const { data: workspace, error: workspaceError } = await db
		.from("workspaces")
		.select("id")
		.eq("owner_id", ownerId)
		.maybeSingle()

	if (workspaceError) {
		throw new EntitlementResolutionError("workspace-read", workspaceError.message || "workspace read failed")
	}
	const workspaceId = workspace ? asString((workspace as { id?: unknown }).id) : null
	if (!workspaceId) return null

	const { data: plan, error: planError } = await db
		.from("workspace_plans")
		.select(ENTITLEMENT_COLUMNS)
		.eq("workspace_id", workspaceId)
		.maybeSingle()

	if (planError) {
		throw new EntitlementResolutionError("plan-read", planError.message || "workspace_plans read failed")
	}
	if (!plan) return null

	return entitlementFromRow(plan as WorkspacePlanRowLike, options)
}
