/**
 * T10 — server-only billing reconciliation (plan T10; spec §6/§8; PRD US-7/US-12
 * AC2; PDEC-7; TL B3).
 *
 * Webhooks are the single source of entitlement truth (spec §6) — this cron is
 * the fallback that converges state the webhooks never delivered. Its one
 * direction is provider → us (spec §8 precedence):
 *
 *  - the `workspace_plans` row is the watermark source (`last_checked_at`, T3
 *    column; TL B3 — never derived from `gateway_events`, which replays make
 *    ambiguous), and only rows with a real rail (`gateway != 'none'`) are polled;
 *  - each row's subscription is read back from the provider and the entitlement
 *    is written through T8's `applyEntitlementFromReadBack` — the SAME apply
 *    primitive every webhook uses, so clock/Razorpay-cancel/terminal/mirror
 *    semantics can never drift between the two writers;
 *  - `profiles.plan` mirror convergence rides that primitive too;
 *  - referral credits settle only when a confirming paid invoice exists (T9):
 *    the ledger stays the applied truth (an unconfirmed row is NOT settled), and
 *    the provider's own credit mechanism remains the sole renewer (PDEC-2/3).
 *
 * Read-back selection: the plan names `gatewayForRail/getSubscriptionState`, and
 * those rails' maps are deliberately fail-open for CHECKOUT gating (unrecognised
 * Razorpay status ⇒ `active`, which blocks a second charge). Writing entitlements
 * from that map could GRANT on an unrecognised status, so reconciliation uses
 * T8's entitlement-grade read-backs instead (`defaultStripeReadBack` /
 * `defaultRazorpayReadBack`): same per-rail provider read, but unknown Razorpay
 * statuses fail loudly instead of becoming `active`. This is the plan's intent
 * (per-rail read-back converging to provider truth) without a fail-open write.
 *
 * Partial failures never abort the sweep (same posture as retention-prune): each
 * workspace is processed independently, the failure is reported per row, and the
 * route answers 500 so ops retries — a failed row keeps its old watermark and is
 * re-checked on the next run. Logs are PII-minimized (workspace ids and reason
 * codes, never payloads or provider response bodies).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { SubscriptionNotFoundError, type BillingCycle, type BillingTier, type Rail } from "@/lib/billing/gateway"
import { RazorpayApiError, createRazorpayHttpClient } from "@/lib/billing/razorpay"
import { getStripeClient } from "@/lib/billing/stripe"
import {
	applyCreditsAtRenewal,
	type ApplyCreditsResult,
} from "./referral-credits"
import {
	EntitlementApplyError,
	applyEntitlementFromReadBack,
	defaultRazorpayReadBack,
	defaultStripeReadBack,
	type SubscriptionReadBack,
} from "./webhook-processor"

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Default staleness horizon for the `last_checked_at` watermark. The cron runs
 * daily (PDEC-7, 04:30 UTC); 23h leaves room for scheduler jitter so every row is
 * still checked once per day while an overlapping/duplicate invocation does not
 * hammer the provider APIs.
 */
export const DEFAULT_RECONCILE_WATERMARK_MS = 23 * 60 * 60 * 1000

/**
 * Bounded work budget per invocation. The stale set is queried oldest-watermark
 * first, so rows not reached in this run remain stale and are picked up by the
 * next run — no billed workspace is ever silently dropped (PostgREST's default
 * 1000-row cap is never hit because the query itself is capped and filtered).
 */
export const MAX_WORKSPACES_PER_SWEEP = 200

export type ReadSubscriptionForRail = (
	rail: Rail,
	subscriptionRef: string,
) => Promise<SubscriptionReadBack | null>

/**
 * Corroborates a provider 404 before it may terminalize an entitlement: both
 * rails retain their objects (a cancelled subscription is still retrievable), so
 * a "missing" subscription usually means the key/account is wrong — the one case
 * where writing `free` would mass-downgrade paying customers. `false` means the
 * customer binding is also absent from this account (mismatch ⇒ fail loud, no
 * write); a live customer with a missing subscription is a genuine deletion.
 */
export type CustomerExists = (rail: Rail, customerRef: string) => Promise<boolean>

export interface ConfirmingInvoiceQuery {
	workspaceId: string
	customerRef: string | null
	subscriptionRef: string | null
	/** ISO instant of the earliest unapplied grant / previous watermark. */
	since: string
}

export interface ConfirmingInvoice {
	invoiceId: string
	paidAt: string
}

/** Provider invoice read-back (Stripe-only: INR banks, PDEC-2). */
export type FindConfirmingInvoice = (query: ConfirmingInvoiceQuery) => Promise<ConfirmingInvoice | null>

export type ReferralSettlementOutcome =
	| "settled"
	| "no-banked"
	| "no-confirming-invoice"
	| "not-stripe"
	| "no-active-subscription"
	| "no-customer-id"
	| "provider-error"

export type ReconciliationOutcome =
	| "converged"
	| "unchanged"
	| "skipped-fresh"
	| "no-subscription"
	| "subscription-gone"
	| "provider-error"
	| "config-error"

export interface WorkspaceReconcileResult {
	workspaceId: string
	rail: Rail | null
	outcome: ReconciliationOutcome
	/** True when the provider read-back converged the row to a terminal state. */
	terminal?: boolean
	referral?: ReferralSettlementOutcome
	detail?: string
}

export interface ReconciliationSummary {
	/** Stale billed rows returned by the work-list query (bounded per sweep). */
	scanned: number
	/** Rows actually polled this run. */
	checked: number
	converged: number
	unchanged: number
	skippedFresh: number
	gone: number
	/** Rows whose convergence or referral settlement failed (route answers 500). */
	failures: number
	referralsSettled: number
	results: WorkspaceReconcileResult[]
}

export interface ReconcileBillingOptions {
	db: SupabaseClient
	now?: () => Date
	watermarkMs?: number
	/** Provider read-back seam (defaults to T8's entitlement-grade per-rail read). */
	readSubscription?: ReadSubscriptionForRail
	/** 404 corroboration seam (defaults to the rail's customer lookup). */
	customerExists?: CustomerExists
	/** Confirm-invoice seam (defaults to Stripe's paid-invoice list). */
	findConfirmingInvoice?: FindConfirmingInvoice
	/** T9 apply seam (defaults to `applyCreditsAtRenewal`). */
	applyCredits?: (db: SupabaseClient, workspaceId: string) => Promise<ApplyCreditsResult>
}

/** Fatal query failure — the sweep cannot even read its work list. */
export class BillingReconciliationError extends Error {
	constructor(
		readonly table: string,
		message: string,
	) {
		super(`[billing/reconciliation] ${table}: ${message}`)
		this.name = "BillingReconciliationError"
	}
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

const PLAN_COLUMNS =
	"workspace_id, tier, billing_cycle, gateway, gateway_customer_id, gateway_subscription_id, currency, is_founding, seats, status, current_period_end, cancel_at_period_end, past_due_since, last_checked_at"

interface PlanRow {
	workspace_id: string
	tier: string
	billing_cycle: string
	gateway: string
	gateway_customer_id: string | null
	gateway_subscription_id: string | null
	currency: string | null
	is_founding: boolean
	seats: number | null
	status: string
	current_period_end: string | null
	cancel_at_period_end: boolean
	past_due_since: string | null
	last_checked_at: string | null
}

const PAYABLE_STATUSES: ReadonlySet<string> = new Set(["active", "past_due"])

// ---------------------------------------------------------------------------
// Default provider seams
// ---------------------------------------------------------------------------

/** One HTTP transport for the whole sweep (Razorpay's client is stateless but cheap to reuse). */
function defaultReadSubscription(): ReadSubscriptionForRail {
	const stripe = defaultStripeReadBack()
	const razorpay = defaultRazorpayReadBack(createRazorpayHttpClient())
	return (rail, subscriptionRef) => (rail === "stripe" ? stripe(subscriptionRef) : razorpay(subscriptionRef))
}

function isStripeResourceMissing(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "resource_missing"
}

/**
 * Default 404 corroboration: does the stored customer binding still exist on the
 * rail this process is authenticated against? A missing customer means a key /
 * account / mode mismatch — the caller fails the row instead of downgrading it.
 */
function defaultCustomerExists(): CustomerExists {
	const razorpayHttp = createRazorpayHttpClient()
	return async (rail, customerRef) => {
		if (rail === "stripe") {
			try {
				await getStripeClient().customers.retrieve(customerRef)
				return true
			} catch (err) {
				if (isStripeResourceMissing(err)) return false
				throw err
			}
		}
		try {
			await razorpayHttp.request({ method: "GET", path: `/customers/${encodeURIComponent(customerRef)}` })
			return true
		} catch (err) {
			if (err instanceof RazorpayApiError && err.status === 404) return false
			throw err
		}
	}
}

function defaultFindConfirmingInvoice(): FindConfirmingInvoice {
	return async ({ customerRef, subscriptionRef, since }) => {
		const sinceMs = Date.parse(since)
		if (!Number.isFinite(sinceMs)) return null
		// No rail reference means invoices cannot be attributed with confidence —
		// never guess (a wrong invoice would settle months that never billed).
		if (!subscriptionRef && !customerRef) return null

		const client = getStripeClient()
		const params: Parameters<typeof client.invoices.list>[0] = {
			status: "paid",
			created: { gte: Math.floor(sinceMs / 1000) },
			limit: 10,
		}
		if (subscriptionRef) params.subscription = subscriptionRef
		else params.customer = customerRef as string

		const list = await client.invoices.list(params)
		const invoice = list.data.find((candidate) => candidate.status === "paid")
		if (!invoice) return null
		const paidAtSeconds = invoice.status_transitions?.paid_at ?? invoice.created
		return { invoiceId: invoice.id, paidAt: new Date(paidAtSeconds * 1000).toISOString() }
	}
}

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

function isGone(err: unknown): boolean {
	if (err instanceof SubscriptionNotFoundError) return true
	return err instanceof RazorpayApiError && err.status === 404
}

/** Provider reports the stored subscription gone: converge to a terminal state. */
function goneState(row: PlanRow): SubscriptionReadBack {
	return {
		subscriptionRef: row.gateway_subscription_id as string,
		// Preserve the stored customer binding so a resubscribe reuses the same
		// provider customer (US-6 AC2) — the read-back is gone, the DB row isn't.
		customerRef: row.gateway_customer_id,
		workspaceId: row.workspace_id,
		status: "canceled",
		cancelAtPeriodEnd: false,
		currentPeriodEnd: null,
		tier: null,
		cycle: null,
		isFounding: false,
		seats: null,
	}
}

/**
 * Entitlement-grade read-back merged with the DB row:
 *  - the workspace binding is the row (`workspaces.id` is the billing root), never
 *    provider metadata — reconciliation already knows which row it is polling;
 *  - tier/cycle fall back to the stored values when the provider price/plan id is
 *    not reverse-mapped (reconciliation converges status/period/cancel; it never
 *    invents a plan change, and an unmapped price for a workspace with no stored
 *    plan still fails loudly in the apply step);
 *  - founding is sticky (locked at creation, spec §15).
 */
function mergeReadBack(row: PlanRow, state: SubscriptionReadBack): SubscriptionReadBack {
	const terminal = state.status === "canceled"
	if (!terminal && (state.tier == null || state.cycle == null) && row.tier !== "free" && row.billing_cycle !== "none") {
		// L4: reconciliation converges status/period; it never invents a plan change.
		// An unmapped provider price keeps the stored tier, but the drift must be
		// observable rather than silently masked.
		console.warn("[billing/reconciliation] provider price not reverse-mapped; preserving stored tier", {
			workspaceId: row.workspace_id,
			tier: row.tier,
		})
	}
	const tier = state.tier ?? (row.tier !== "free" ? (row.tier as BillingTier) : null)
	const cycle = state.cycle ?? (row.billing_cycle !== "none" ? (row.billing_cycle as BillingCycle) : null)
	return {
		...state,
		subscriptionRef: row.gateway_subscription_id as string,
		customerRef: state.customerRef ?? row.gateway_customer_id,
		workspaceId: row.workspace_id,
		tier: terminal ? null : tier,
		cycle: terminal ? null : cycle,
		isFounding: state.isFounding || row.is_founding === true,
		seats: state.seats ?? row.seats,
	}
}

async function stampChecked(
	db: SupabaseClient,
	workspaceId: string,
	checkedAt: string,
): Promise<void> {
	const stamped = await db
		.from("workspace_plans")
		.update({ last_checked_at: checkedAt })
		.eq("workspace_id", workspaceId)
	if (stamped.error) {
		throw new BillingReconciliationError("workspace_plans", stamped.error.message ?? "last_checked_at update failed")
	}
}

// ---------------------------------------------------------------------------
// Referral settlement (T9 seam)
// ---------------------------------------------------------------------------

/**
 * Settle banked referral months only when a confirming paid invoice exists.
 *
 * The confirming invoice is a paid provider invoice on this workspace's
 * subscription at/after the EARLIEST unapplied ledger row's grant. Nothing is
 * settled without it: the ledger is the applied truth (spec §8), and a banked
 * month that never billed must not disappear. An invoice that predates the grant
 * cannot confirm it, so a month granted after the last billing event waits for
 * the next renewal. When the invoice does exist, T9's `applyCreditsAtRenewal`
 * runs the same claim → provider-credit → settle pipeline the `invoice.paid`
 * webhook uses (its row-set idempotency key makes a replay of a crashed apply
 * safe), so the provider remains the sole renewer (PDEC-2/3). A pending claim is
 * always newer than its grant, so the grant anchor also covers crash recovery.
 */
type ReferralSettlementDeps = {
	db: SupabaseClient
	findConfirmingInvoice: FindConfirmingInvoice
	applyCredits: (db: SupabaseClient, workspaceId: string) => Promise<ApplyCreditsResult>
}

async function settleReferralIfConfirmed(
	row: PlanRow,
	deps: ReferralSettlementDeps,
): Promise<ReferralSettlementOutcome> {
	// INR credits bank ledger-accurately; there is no redemption mechanism (PDEC-2).
	if (row.gateway !== "stripe" || row.currency === "INR") return "not-stripe"
	if (!PAYABLE_STATUSES.has(row.status)) return "no-active-subscription"
	if (!row.gateway_customer_id) return "no-customer-id"

	const earliestGrant = await earliestPendingGrant(deps.db, row.workspace_id)
	if (!earliestGrant) return "no-banked"

	const invoice = await deps.findConfirmingInvoice({
		workspaceId: row.workspace_id,
		customerRef: row.gateway_customer_id,
		subscriptionRef: row.gateway_subscription_id,
		since: earliestGrant,
	})
	if (!invoice) return "no-confirming-invoice"

	const applied = await deps.applyCredits(deps.db, row.workspace_id)
	switch (applied.reason) {
		case "applied":
			return "settled"
		case "nothing-banked":
			return "no-banked"
		case "not-stripe-rail":
			return "not-stripe"
		case "no-active-subscription":
		case "no-plan-row":
			return "no-active-subscription"
		case "no-customer-id":
			return "no-customer-id"
		default:
			return "provider-error"
	}
}

/** Earliest unapplied ledger grant for a workspace, or null when nothing is banked. */
async function earliestPendingGrant(db: SupabaseClient, workspaceId: string): Promise<string | null> {
	const pending = await db
		.from("referral_credit_ledger")
		.select("granted_at")
		.eq("workspace_id", workspaceId)
		.is("applied_at", null)
		.order("granted_at", { ascending: true })
		.limit(1)
	if (pending.error) {
		throw new BillingReconciliationError(
			"referral_credit_ledger",
			pending.error.message ?? "pending ledger read failed",
		)
	}
	const rows = (pending.data ?? []) as Array<{ granted_at: string | null }>
	const earliest = rows.map((entry) => entry.granted_at).find((value): value is string => typeof value === "string")
	return earliest ?? null
}

// ---------------------------------------------------------------------------
// Per-workspace sweep
// ---------------------------------------------------------------------------

async function reconcileWorkspace(
	row: PlanRow,
	deps: {
		db: SupabaseClient
		nowMs: number
		watermarkMs: number
		readSubscription: ReadSubscriptionForRail
		customerExists: CustomerExists
		findConfirmingInvoice: FindConfirmingInvoice
		applyCredits: (db: SupabaseClient, workspaceId: string) => Promise<ApplyCreditsResult>
	},
): Promise<WorkspaceReconcileResult> {
	const rail = row.gateway as Rail
	const base = { workspaceId: row.workspace_id, rail }

	// Watermark (TL B3): the work-list query already excludes fresh rows; this is
	// the in-memory race guard for a row that was checked between query and apply.
	if (row.last_checked_at) {
		const lastChecked = Date.parse(row.last_checked_at)
		if (Number.isFinite(lastChecked) && deps.nowMs - lastChecked < deps.watermarkMs) {
			return { ...base, outcome: "skipped-fresh" }
		}
	}

	// No provider reference means there is nothing to read back yet (e.g. checkout
	// initiated but never activated). Stamp it so the sweep does not rescan daily.
	if (!row.gateway_subscription_id) {
		await stampChecked(deps.db, row.workspace_id, new Date(deps.nowMs).toISOString())
		return { ...base, outcome: "no-subscription" }
	}

	let state: SubscriptionReadBack | null = null
	let gone = false
	try {
		state = await deps.readSubscription(rail, row.gateway_subscription_id)
	} catch (err) {
		if (isGone(err)) {
			gone = true
		} else {
			// PII-minimized: provider error objects may embed response bodies.
			console.error("[billing/reconciliation] provider read-back failed", {
				workspaceId: row.workspace_id,
				rail,
				err: err instanceof Error ? err.message : "read-back failed",
			})
			return { ...base, outcome: "provider-error", detail: "provider read-back failed" }
		}
	}

	if (!state && !gone) {
		gone = true
	}

	// A 404 must never terminalize on its own (H1): both rails retain cancelled
	// subscriptions, so "missing" usually means a wrong key/account/mode — the one
	// failure mode that would mass-downgrade paying workspaces. Corroborate with
	// the stored customer binding; mismatch ⇒ loud failure, no write.
	if (gone) {
		if (!row.gateway_customer_id) {
			return {
				...base,
				outcome: "provider-error",
				detail: "subscription missing without a stored customer binding; refusing to terminalize",
			}
		}
		let customerPresent: boolean
		try {
			customerPresent = await deps.customerExists(rail, row.gateway_customer_id)
		} catch (err) {
			console.error("[billing/reconciliation] customer corroboration failed", {
				workspaceId: row.workspace_id,
				rail,
				err: err instanceof Error ? err.message : "customer lookup failed",
			})
			return { ...base, outcome: "provider-error", detail: "customer corroboration failed" }
		}
		if (!customerPresent) {
			console.error("[billing/reconciliation] provider account mismatch; refusing to terminalize", {
				workspaceId: row.workspace_id,
				rail,
			})
			return { ...base, outcome: "provider-error", detail: "provider account mismatch (customer not found)" }
		}
		state = goneState(row)
	}

	const merged = mergeReadBack(row, state as SubscriptionReadBack)

	try {
		const applied = await applyEntitlementFromReadBack(rail, { db: deps.db, now: () => new Date(deps.nowMs) }, merged)
		if (applied.staleGeneration) {
			// Same-ref read-back cannot be stale, but keep the guard honest: nothing
			// was written, and this row is left for a later generation's own read-back.
			return { ...base, outcome: "unchanged", detail: "stale subscription generation" }
		}

		// The referral decision uses post-convergence state (the entitlement apply is
		// durable first, exactly like T8's hook ordering).
		const effectiveRow: PlanRow = {
			...row,
			status: merged.status,
			gateway_customer_id: merged.customerRef,
			tier: merged.tier ?? row.tier,
			billing_cycle: merged.cycle ?? row.billing_cycle,
			cancel_at_period_end: merged.cancelAtPeriodEnd,
		}
		let referral: ReferralSettlementOutcome | undefined
		let referralFailed = false
		try {
			referral = await settleReferralIfConfirmed(effectiveRow, deps)
			referralFailed = referral === "provider-error"
		} catch (err) {
			console.error("[billing/reconciliation] referral settlement failed", {
				workspaceId: row.workspace_id,
				err: err instanceof Error ? err.message : "settlement failed",
			})
			referral = "provider-error"
			referralFailed = true
		}

		// A referral failure must NOT advance the watermark (M2): the header
		// contract says a failed row is re-checked on the next run, and a manual
		// re-run has to attempt the settlement again instead of reporting green.
		if (referralFailed) {
			return {
				...base,
				outcome: applied.planChanged ? "converged" : "unchanged",
				terminal: applied.terminal,
				referral,
				detail: "referral settlement failed",
			}
		}

		await stampChecked(deps.db, row.workspace_id, new Date(deps.nowMs).toISOString())

		if (gone) {
			return { ...base, outcome: "subscription-gone", terminal: true, referral }
		}
		return {
			...base,
			outcome: applied.planChanged ? "converged" : "unchanged",
			terminal: applied.terminal,
			referral,
		}
	} catch (err) {
		if (err instanceof EntitlementApplyError) {
			console.error("[billing/reconciliation] entitlement apply failed", {
				workspaceId: row.workspace_id,
				rail,
				stage: err.stage,
				err: err.message,
			})
			return {
				...base,
				outcome: err.stage === "price-mapping" ? "config-error" : "provider-error",
				detail: `${err.stage}: ${err.message}`,
			}
		}
		console.error("[billing/reconciliation] unexpected apply failure", {
			workspaceId: row.workspace_id,
			rail,
			err: err instanceof Error ? err.message : "apply failed",
		})
		return { ...base, outcome: "provider-error", detail: "entitlement apply failed" }
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * One reconciliation sweep: select every billed workspace past its
 * `last_checked_at` watermark, converge each toward provider truth, then settle
 * referral credits that a confirming invoice backs.
 *
 * Never throws for a single workspace failure — the summary reports it and the
 * route maps any failure to a 5xx so ops sees the run as unhealthy. Only the work
 * list query (a hard DB failure) throws.
 */
export async function reconcileBilling(options: ReconcileBillingOptions): Promise<ReconciliationSummary> {
	const { db } = options
	const now = options.now ?? (() => new Date())
	const nowMs = now().getTime()
	const watermarkMs = options.watermarkMs ?? DEFAULT_RECONCILE_WATERMARK_MS
	const readSubscription = options.readSubscription ?? defaultReadSubscription()
	const customerExists = options.customerExists ?? defaultCustomerExists()
	const findConfirmingInvoice = options.findConfirmingInvoice ?? defaultFindConfirmingInvoice()
	const applyCredits =
		options.applyCredits ?? ((client: SupabaseClient, workspaceId: string) => applyCreditsAtRenewal(client, workspaceId))

	// Billing roots only: a free workspace (`gateway = 'none'`) has nothing to
	// reconcile and never touches a provider. The watermark predicate is pushed
	// into the query (`last_checked_at IS NULL OR < cutoff`) so PostgREST's row cap
	// can never silently drop billed workspaces, and the stale set is ordered
	// oldest-first with a hard per-invocation budget: rows not reached stay stale
	// and are picked up by the next run.
	const cutoff = new Date(nowMs - watermarkMs).toISOString()
	const listed = await db
		.from("workspace_plans")
		.select(PLAN_COLUMNS)
		.neq("gateway", "none")
		.or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
		.order("last_checked_at", { ascending: true, nullsFirst: true })
		.limit(MAX_WORKSPACES_PER_SWEEP)
	if (listed.error) {
		throw new BillingReconciliationError("workspace_plans", listed.error.message ?? "workspace_plans read failed")
	}
	const rows = (listed.data ?? []) as unknown as PlanRow[]

	const summary: ReconciliationSummary = {
		scanned: rows.length,
		checked: 0,
		converged: 0,
		unchanged: 0,
		skippedFresh: 0,
		gone: 0,
		failures: 0,
		referralsSettled: 0,
		results: [],
	}

	const deps = { db, nowMs, watermarkMs, readSubscription, customerExists, findConfirmingInvoice, applyCredits }
	for (const row of rows) {
		let result: WorkspaceReconcileResult
		try {
			result = await reconcileWorkspace(row, deps)
		} catch (err) {
			// A hard failure (e.g. last_checked_at write) must not abort the sweep.
			console.error("[billing/reconciliation] workspace sweep failed", {
				workspaceId: row.workspace_id,
				err: err instanceof Error ? err.message : "sweep failed",
			})
			result = { workspaceId: row.workspace_id, rail: (row.gateway as Rail) ?? null, outcome: "provider-error", detail: "sweep failed" }
		}

		summary.results.push(result)
		if (result.outcome === "skipped-fresh") {
			summary.skippedFresh += 1
			continue
		}
		summary.checked += 1
		if (result.outcome === "converged") summary.converged += 1
		else if (result.outcome === "unchanged") summary.unchanged += 1
		else if (result.outcome === "subscription-gone") {
			summary.gone += 1
			summary.converged += 1
		} else if (result.outcome === "provider-error" || result.outcome === "config-error") {
			summary.failures += 1
		}
		if (result.referral === "settled") summary.referralsSettled += 1
		if (result.detail === "referral settlement failed") summary.failures += 1
	}

	return summary
}
