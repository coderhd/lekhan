/**
 * T9 — server-only referral credits service (spec §4.3 + §8; plan T9; PRD US-10/US-11;
 * PDEC-2/3/4).
 *
 * Terminology (spec §8): "referral credits" are banked billing MONTHS on a
 * `workspace_plans` row — not the AI-era credits ledger retired by this epic.
 * The `referral_credit_ledger` is the applied-truth table; `credited_months` is
 * its persisted banked counter (PDEC-10 nit-1).
 *
 * Counter authority (PDEC-4 reconciliation):
 *  - ACTIVATION-stage grants are written by the T3 `workspaces`-INSERT trigger,
 *    which owns the `credited_months` bump for its rows. Nothing here ever bumps
 *    for activation rows. Since the T9-rev resolver migration the trigger's
 *    deferred resolver attaches BOTH stages, so the true guard across writers
 *    is not a stage filter: every writer only touches rows that are still
 *    attachment-pending (`workspace_id IS NULL`), and a row's attach+bump
 *    happens exactly once — whoever gets there first (trigger resolver or this
 *    service's promotion), the other matches zero rows.
 *  - CONVERSION-stage rows are written only by this service; its bump is guarded
 *    the same way the trigger guards its own (bump only when the INSERT actually
 *    landed), so replayed/raced events can never double-count.
 *
 * Redemption rails:
 *  - Stripe (PDEC-3): a negative customer-balance credit
 *    (`POST /v1/customers/{id}/balance_transactions`) equal to banked months ×
 *    the current tier's MONTHLY value; the provider stays the sole renewer and
 *    `current_period_end` is never written locally. One banked month = one
 *    month of the tier value (US-11 AC1), so an annual-cycle plan is normalized
 *    to its same-cohort monthly catalogue amount — a banked month never spends
 *    a full annual catalogue amount.
 *  - Razorpay (PDEC-2): INR credits bank ledger-accurately and this service
 *    NEVER attempts a redemption — no provider credit-balance mechanism exists;
 *    redemption rides the GA pricing decision.
 *
 * Apply claim semantics (clean-room cycle 1, finding 2): claims live in the
 * ledger's `claimed_at` column; `applied_at` is set ONLY on the confirmed
 * settle — i.e. literally "on the confirming invoice.paid". A crashed apply's
 * stale claims are released after a claim TTL and recovered on the next
 * renewal; because the idempotency key is derived from the claimed row set, a
 * recovered replay settles the SAME provider transaction exactly once.
 *
 * Anti-abuse (spec §8.5): same-user and same-email self-referrals are blocked at
 * attribution match-time; the 12-month bank cap is config, not a hardcode
 * (`BILLING_REFERRAL_BANK_CAP_MONTHS`).
 */

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getStripeClient } from "@/lib/billing/stripe"
import type { PaidTier } from "@/lib/billing/prices"
import { resolvePriceRequest } from "@/lib/billing/prices"

// ---------------------------------------------------------------------------
// Bank cap config (spec §8.5 / §16 D10: "config, not hardcode")
// ---------------------------------------------------------------------------

export const REFERRAL_BANK_CAP_ENV = "BILLING_REFERRAL_BANK_CAP_MONTHS"
export const DEFAULT_REFERRAL_BANK_CAP_MONTHS = 12

/** The configured per-workspace bank cap in months; invalid values fall back to the default. */
export function referralBankCapMonths(): number {
	const raw = process.env[REFERRAL_BANK_CAP_ENV]?.trim()
	if (!raw) return DEFAULT_REFERRAL_BANK_CAP_MONTHS
	const parsed = Number(raw)
	if (!Number.isInteger(parsed) || parsed < 0) {
		console.warn(`[billing] invalid ${REFERRAL_BANK_CAP_ENV}="${raw}"; falling back to ${DEFAULT_REFERRAL_BANK_CAP_MONTHS}`)
		return DEFAULT_REFERRAL_BANK_CAP_MONTHS
	}
	return parsed
}

// ---------------------------------------------------------------------------
// Seam + result types
// ---------------------------------------------------------------------------

/**
 * The Stripe client seam used for PDEC-3 redemption — the SDK surface for
 * `POST /v1/customers/{id}/balance_transactions` (negative amount = credit).
 * The real `Stripe` instance satisfies it structurally; unit tests inject a
 * stub at this client seam (no network, no SDK internals under test).
 */
export interface StripeCreditClient {
	customers: {
		createBalanceTransaction(
			customerId: string,
			params: {
				amount: number
				currency: string
				description?: string
				metadata?: Record<string, string>
			},
			options?: { idempotencyKey?: string },
		): Promise<{ id: string }>
	}
}

export type ConversionGrantReason =
	| "granted"
	| "duplicate"
	| "bank-cap"
	| "not-referred"
	| "self-referral"
	| "same-email"
	| "invalid-ref"
	| "unknown-referrer"
	| "no-workspace"

export interface ConversionGrantResult {
	granted: boolean
	reason: ConversionGrantReason
	/** Months newly banked by this call (0 when not granted). */
	months: number
	/** True when the row landed `workspace_id NULL` keyed to the referrer (PDEC-4). */
	deferred: boolean
}

export type ApplyCreditsReason =
	| "applied"
	| "no-plan-row"
	| "not-stripe-rail"
	| "no-active-subscription"
	| "no-customer-id"
	| "nothing-banked"
	| "provider-error"

export interface ApplyCreditsResult {
	applied: boolean
	reason: ApplyCreditsReason
	monthsApplied: number
	/** USD cents of the provider-side credit created (magnitude; 0 when nothing applied). */
	creditMinorUnits: number
	balanceTransactionId: string | null
	/** Provider error detail when reason === "provider-error". */
	detail?: string
}

/** PII-minimized ledger summary for the T12(b) billing UI (US-10 AC2). */
export interface ReferralSummaryRow {
	triggerStage: "activation" | "conversion"
	months: number
	grantedAt: string | null
	appliedAt: string | null
}

export interface ReferralSummary {
	workspaceId: string
	/** Persisted banked counter (`workspace_plans.credited_months`). */
	creditedMonths: number
	/** Ledger truth: unapplied months. */
	bankedMonths: number
	appliedMonths: number
	lifetimeGrantedMonths: number
	activationGrants: number
	conversionGrants: number
	bankCapMonths: number
	capReached: boolean
	rows: ReferralSummaryRow[]
}

/** Query failures are propagated loudly (fail closed, never a silent no-op). */
export class ReferralLedgerError extends Error {
	constructor(
		readonly table: string,
		readonly code: string,
		message: string,
	) {
		super(`[billing/referral-credits] ${table}: ${message} (${code})`)
		this.name = "ReferralLedgerError"
	}
}

interface QueryResult<T> {
	data: T | null
	error: { code?: string; message?: string } | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PAYABLE_STATUSES: ReadonlySet<string> = new Set(["active", "past_due"])

/**
 * Claim staleness horizon for `referral_credit_ledger.claimed_at`. An apply
 * holds its claim for at most this long between claim and settle; anything
 * older is treated as a crashed apply and released on the next renewal (the
 * row-set-derived provider idempotency key makes the recovered replay safe).
 */
const CLAIM_TTL_MS = 10 * 60 * 1000

function isConflict(error: { code?: string } | null | undefined): boolean {
	return error?.code === "23505"
}

function unwrap<T>(res: QueryResult<T>, table: string): T {
	if (res.error) {
		throw new ReferralLedgerError(table, res.error.code ?? "unknown", res.error.message ?? "query failed")
	}
	return res.data as T
}

function md5Lower(email: string): string {
	return createHash("md5").update(email.toLowerCase()).digest("hex")
}

interface WorkspaceRow {
	id: string
	owner_id: string
}

interface AttributionRow {
	ref: string
	email_hash: string | null
}

interface ProfileRow {
	id: string
	email: string | null
}

interface PlanRow {
	workspace_id: string
	tier: string
	billing_cycle: string
	gateway: string
	gateway_customer_id: string | null
	is_founding: boolean
	seats: number | null
	status: string
	currency: string | null
	credited_months: number
}

interface LedgerMonthsRow {
	months: number
}

interface LedgerClaimRow {
	id: string
	months: number
}

function notGranted(reason: ConversionGrantReason): ConversionGrantResult {
	return { granted: false, reason, months: 0, deferred: false }
}

function applySkip(reason: ApplyCreditsReason, detail?: string): ApplyCreditsResult {
	return { applied: false, reason, monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null, ...(detail ? { detail } : {}) }
}

// ---------------------------------------------------------------------------
// credited_months CAS adjust (single-writer-per-row discipline)
// ---------------------------------------------------------------------------

/**
 * Compare-and-swap adjust of `workspace_plans.credited_months` (read → guarded
 * write with the preimage as the guard; retry on CAS loss). The T3 trigger bumps
 * the counter with SQL-side arithmetic; a concurrent bump makes one CAS attempt
 * fail, and the retry re-reads the fresh value — so the service's conversion
 * bump and the trigger's activation bump can never clobber each other.
 */
async function adjustCreditedMonths(db: SupabaseClient, workspaceId: string, delta: number): Promise<void> {
	for (let attempt = 0; attempt < 4; attempt++) {
		const { data, error } = await db
			.from("workspace_plans")
			.select("credited_months")
			.eq("workspace_id", workspaceId)
			.maybeSingle()
		if (error) throw new ReferralLedgerError("workspace_plans", error.code ?? "unknown", error.message ?? "plan read failed")

		if (!data) {
			// Billing root missing (the trigger normally guarantees it): create the row
			// for a positive delta, mirroring the trigger's insert-if-missing pattern.
			// A negative delta has nothing to decrement — skip (ledger stays the truth).
			if (delta < 0) return
			const ins = await db
				.from("workspace_plans")
				.insert({ workspace_id: workspaceId, tier: "free", credited_months: Math.max(0, delta) })
				.select("workspace_id")
			if (isConflict(ins.error)) continue // raced with the trigger — retry the CAS
			if (ins.error) throw new ReferralLedgerError("workspace_plans", ins.error.code ?? "unknown", ins.error.message ?? "plan insert failed")
			return
		}

		const current = Number((data as { credited_months: number }).credited_months) || 0
		const target = Math.max(0, current + delta)
		const upd = await db
			.from("workspace_plans")
			.update({ credited_months: target, updated_at: new Date().toISOString() })
			.eq("workspace_id", workspaceId)
			.eq("credited_months", current)
			.select("workspace_id")
		if (upd.error) throw new ReferralLedgerError("workspace_plans", upd.error.code ?? "unknown", upd.error.message ?? "plan update failed")
		if ((upd.data as unknown[] | null)?.length) return
		// CAS lost (concurrent trigger bump): re-read and retry.
	}
	console.error("[billing] credited_months CAS retries exhausted", { workspaceId, delta })
}

// ---------------------------------------------------------------------------
// Grant: paid-conversion referral month (US-10 AC2 / spec §8.3)
// ---------------------------------------------------------------------------

/**
 * Bank the conversion-stage referral month when a referred workspace converts
 * paid. Wired from T8's paid-conversion detection (`checkout.session.completed`
 * / `subscription.authenticated`) after the entitlement apply (TL A4).
 *
 * The activation rows for this invitee already exist via T3's `workspaces`
 * trigger; the per-stage `UNIQUE (workspace_id, invitee_ref, trigger_stage)` is
 * what makes this SECOND grant possible while re-grants of the same stage stay
 * impossible. Dedup and the bank cap are checked against both the resolved and
 * the deferred (PDEC-4) ledger slots; the counter bump is guarded by the insert
 * actually landing, so replayed events never double-count.
 *
 * Rail-agnostic by design: a Razorpay (INR) conversion banks its month exactly
 * like a Stripe one — only redemption differs (PDEC-2).
 */
export async function grantConversionIfReferred(
	db: SupabaseClient,
	workspaceOfConvertedUser: string,
): Promise<ConversionGrantResult> {
	const ws = unwrap<WorkspaceRow | null>(
		await db.from("workspaces").select("id, owner_id").eq("id", workspaceOfConvertedUser).maybeSingle(),
		"workspaces",
	)
	if (!ws) return notGranted("no-workspace")
	const inviteeUserId = ws.owner_id

	const attribution = unwrap<AttributionRow | null>(
		await db.from("referral_attribution").select("ref, email_hash").eq("user_id", inviteeUserId).maybeSingle(),
		"referral_attribution",
	)
	if (!attribution) return notGranted("not-referred")

	const ref = String(attribution.ref ?? "")
	// At H0 the ref is the referrer's user id; campaign refs resolve to no referrer
	// (same stance as the T3 trigger).
	if (!UUID_RE.test(ref)) return notGranted("invalid-ref")

	const referrerUserId = ref
	// Self-referral at match-time — the trigger's own id guard mirrored here.
	if (referrerUserId === inviteeUserId) return notGranted("self-referral")

	const referrer = unwrap<ProfileRow | null>(
		await db.from("profiles").select("id, email").eq("id", referrerUserId).maybeSingle(),
		"profiles",
	)
	// The profile guard doubles as the ledger FK guard (spec §4.3 referrer key).
	if (!referrer) return notGranted("unknown-referrer")

	// Same-email farming vector: the invitee's signup email (hashed at attribution
	// time, T3) equal to the referrer's email blocks the grant (spec §8.5).
	if (attribution.email_hash && referrer.email && md5Lower(referrer.email) === attribution.email_hash) {
		return notGranted("same-email")
	}

	const referrerWsRow = unwrap<{ id: string } | null>(
		await db.from("workspaces").select("id").eq("owner_id", referrerUserId).limit(1).maybeSingle(),
		"workspaces",
	)
	const referrerWorkspaceId = referrerWsRow?.id ?? null

	// Dedup pre-check against both slots (resolved + deferred partial-unique row).
	const duplicate = await existingConversionRow(db, referrerWorkspaceId, referrerUserId, inviteeUserId)
	if (duplicate) return notGranted("duplicate")

	// Bank cap over OUTSTANDING months (ledger truth, not the counter cache).
	const outstanding = await outstandingBankedMonths(db, referrerWorkspaceId, referrerUserId)
	const cap = referralBankCapMonths()
	if (outstanding + 1 > cap) return notGranted("bank-cap")

	const grantedAt = new Date().toISOString()

	if (!referrerWorkspaceId) {
		// PDEC-4 deferred grant: bank keyed to the referrer's user id; the row is
		// attached (and bumped) when the referrer's workspace materializes — for
		// conversion rows that resolution is this service's promotion below.
		const ins = await db
			.from("referral_credit_ledger")
			.insert({
				workspace_id: null,
				referrer_user_id: referrerUserId,
				source_ref: ref,
				invitee_ref: inviteeUserId,
				invitee_user_id: inviteeUserId,
				trigger_stage: "conversion",
				months: 1,
				granted_at: grantedAt,
				applied_at: null,
			})
			.select("id")
		if (isConflict(ins.error)) return notGranted("duplicate")
		unwrap(ins, "referral_credit_ledger")
		return { granted: true, reason: "granted", months: 1, deferred: true }
	}

	// Opportunistic promotion of the referrer's deferred CONVERSION rows.
	// Since the T9-rev resolver migration the T3 trigger's deferred resolver
	// attaches BOTH stages at workspace creation, so this promotion is the
	// belt-and-braces path for a row deferred by a conversion that raced past a
	// just-created workspace. The update re-checks `workspace_id IS NULL`, so
	// concurrent resolvers (trigger or this service) bump each ledger row exactly
	// once.
	const promoted = unwrap<LedgerMonthsRow[]>(
		await db
			.from("referral_credit_ledger")
			.update({ workspace_id: referrerWorkspaceId })
			.eq("referrer_user_id", referrerUserId)
			.is("workspace_id", null)
			.eq("trigger_stage", "conversion")
			.select("id, months"),
		"referral_credit_ledger",
	)
	const promotedMonths = promoted.reduce((total, row) => total + (Number(row.months) || 0), 0)

	const ins = await db
		.from("referral_credit_ledger")
		.insert({
			workspace_id: referrerWorkspaceId,
			referrer_user_id: referrerUserId,
			source_ref: ref,
			invitee_ref: inviteeUserId,
			invitee_user_id: inviteeUserId,
			trigger_stage: "conversion",
			months: 1,
			granted_at: grantedAt,
			applied_at: null,
		})
		.select("id")
	const inserted = !ins.error && ((ins.data as unknown[] | null)?.length ?? 0) > 0
	if (ins.error && !isConflict(ins.error)) unwrap(ins, "referral_credit_ledger") // propagate real failures

	// PDEC-4: the bump is guarded by the insert actually landing (mirrors the
	// trigger's `RETURNING id` pattern) — a raced duplicate bumps nothing.
	const delta = promotedMonths + (inserted ? 1 : 0)
	if (delta > 0) await adjustCreditedMonths(db, referrerWorkspaceId, delta)

	if (!inserted) return notGranted("duplicate")
	return { granted: true, reason: "granted", months: delta, deferred: false }
}

async function existingConversionRow(
	db: SupabaseClient,
	referrerWorkspaceId: string | null,
	referrerUserId: string,
	inviteeUserId: string,
): Promise<boolean> {
	if (referrerWorkspaceId) {
		const resolved = unwrap<{ id: string } | null>(
			await db
				.from("referral_credit_ledger")
				.select("id")
				.eq("workspace_id", referrerWorkspaceId)
				.eq("invitee_ref", inviteeUserId)
				.eq("trigger_stage", "conversion")
				.maybeSingle(),
			"referral_credit_ledger",
		)
		if (resolved) return true
	}
	const deferred = unwrap<{ id: string } | null>(
		await db
			.from("referral_credit_ledger")
			.select("id")
			.is("workspace_id", null)
			.eq("referrer_user_id", referrerUserId)
			.eq("invitee_ref", inviteeUserId)
			.eq("trigger_stage", "conversion")
			.maybeSingle(),
		"referral_credit_ledger",
	)
	return deferred != null
}

async function outstandingBankedMonths(
	db: SupabaseClient,
	referrerWorkspaceId: string | null,
	referrerUserId: string,
): Promise<number> {
	let total = 0
	if (referrerWorkspaceId) {
		const rows = unwrap<LedgerMonthsRow[]>(
			await db
				.from("referral_credit_ledger")
				.select("months")
				.eq("workspace_id", referrerWorkspaceId)
				.is("applied_at", null)
				.order("granted_at", { ascending: true }),
			"referral_credit_ledger",
		)
		for (const row of rows) total += Number(row.months) || 0
	}
	const deferred = unwrap<LedgerMonthsRow[]>(
		await db
			.from("referral_credit_ledger")
			.select("months")
			.is("workspace_id", null)
			.eq("referrer_user_id", referrerUserId)
			.is("applied_at", null)
			.order("granted_at", { ascending: true }),
		"referral_credit_ledger",
	)
	for (const row of deferred) total += Number(row.months) || 0
	return total
}

// ---------------------------------------------------------------------------
// Apply: Stripe redemption at renewal (US-11 AC1 / PDEC-3; Razorpay PDEC-2)
// ---------------------------------------------------------------------------

/**
 * Apply banked referral months when a renewal invoice is confirmed paid
 * (`invoice.paid`, wired from T8) — STRIPE ONLY.
 *
 * PDEC-3: a negative customer-balance credit of `months × the current tier's
 * MONTHLY value` (tier × persisted cohort; Team × seats) is created via
 * `POST /v1/customers/{id}/balance_transactions`; Stripe applies it to future
 * invoices as the sole renewer. One banked month = one month of the tier value
 * (US-11 AC1): annual-cycle plans are normalized to the same-cohort monthly
 * catalogue amount (the annual catalogue number is a YEARLY figure), never a
 * whole year's price per credit. The ledger rows are claimed (`claimed_at`)
 * BEFORE the provider call with a row-set-derived idempotency key; `applied_at`
 * is set ONLY on the confirmed settle. Replayed `invoice.paid` events claim
 * nothing, and a claim stranded by a process crash is recovered after the claim
 * TTL — the stable idempotency key makes the recovered replay settle the same
 * provider transaction exactly once, never double-crediting or
 * double-decrementing. `credited_months` is decremented only here, and ONLY by
 * the months actually settled (PDEC-4: apply/decrement never happens on grant
 * paths), and `current_period_end` is never written locally (spec §8
 * precedence).
 *
 * Razorpay/INR (PDEC-2): there is no provider credit-balance mechanism — this
 * returns `not-stripe-rail` without touching the ledger or any client. Credits
 * bank ledger-accurately; redemption rides the GA pricing decision.
 */
export async function applyCreditsAtRenewal(
	db: SupabaseClient,
	workspaceId: string,
	deps: { stripe?: StripeCreditClient } = {},
): Promise<ApplyCreditsResult> {
	const plan = unwrap<PlanRow | null>(
		await db.from("workspace_plans").select("*").eq("workspace_id", workspaceId).maybeSingle(),
		"workspace_plans",
	)
	if (!plan) return applySkip("no-plan-row")
	if (plan.gateway !== "stripe" || plan.currency === "INR") return applySkip("not-stripe-rail")
	if (!PAYABLE_STATUSES.has(plan.status) || plan.tier === "free" || plan.billing_cycle === "none") {
		return applySkip("no-active-subscription")
	}
	if (!plan.gateway_customer_id) return applySkip("no-customer-id")

	// Price resolves from server config only (invariant 4); the cohort namespace
	// comes from the PERSISTED is_founding flag. An annual-cycle plan still has
	// its annual binding resolved first so a broken cycle binding fails closed
	// before any claim, then credits at the same-cohort MONTHLY amount
	// (US-11 AC1). Resolution runs before the claim so a missing price binding
	// cannot strand claimed rows.
	const tier = plan.tier as PaidTier
	const cohort = plan.is_founding === true
	if (plan.billing_cycle === "annual") {
		resolvePriceRequest(tier, "annual", "USD", cohort)
	}
	const monthlyPrice = resolvePriceRequest(tier, "monthly", "USD", cohort)
	const perMonthMinor = tier === "team" ? monthlyPrice.amount * Math.max(1, Math.floor(plan.seats ?? 1)) : monthlyPrice.amount

	// The real `Stripe` client satisfies the credit seam structurally; the seam type
	// keeps unit tests mockable at the client level with no SDK import in this file.
	const stripe: StripeCreditClient = deps.stripe ?? getStripeClient()

	// Recover claims stranded by a crashed apply (process died between claim and
	// settle): release claims older than the TTL first. The idempotency key below
	// is derived from the row set, so releasing + re-claiming the same rows
	// replays the SAME provider call — a settle that happened before the crash is
	// returned verbatim by Stripe and applied exactly once.
	const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString()
	const recovered = await db
		.from("referral_credit_ledger")
		.update({ claimed_at: null })
		.eq("workspace_id", workspaceId)
		.is("applied_at", null)
		.lt("claimed_at", staleBefore)
		.select("id")
	if (recovered.error) {
		console.error("[billing] failed to recover stale referral credit claims", { workspaceId, error: recovered.error })
	}

	// Claim every unapplied, workspace-resolved, unclaimed row atomically (the
	// conditional update is the serialization point — settled rows and fresh
	// claims from a live concurrent apply are never re-claimed).
	const claimTs = new Date().toISOString()
	const claimed = unwrap<LedgerClaimRow[]>(
		await db
			.from("referral_credit_ledger")
			.update({ claimed_at: claimTs })
			.eq("workspace_id", workspaceId)
			.is("applied_at", null)
			.is("claimed_at", null)
			.select("id, months"),
		"referral_credit_ledger",
	)
	if (claimed.length === 0) return applySkip("nothing-banked")

	const months = claimed.reduce((total, row) => total + (Number(row.months) || 0), 0)
	const creditMinorUnits = months * perMonthMinor
	const rowIds = claimed.map((row) => row.id).sort()
	// Stable across release/retry of the SAME row set; a later renewal with newly
	// banked rows is a different set and therefore a different key.
	const idempotencyKey = `referral-credit-${workspaceId}:${createHash("sha256").update(rowIds.join(",")).digest("hex").slice(0, 24)}`

	let balanceTransactionId: string
	try {
		const credit = await stripe.customers.createBalanceTransaction(
			plan.gateway_customer_id,
			{
				// Negative amount = credit applied by Stripe to future invoices (PDEC-3).
				amount: -creditMinorUnits,
				currency: "usd",
				description: `Referral credit — ${months} banked month(s)`,
				metadata: { workspace_id: workspaceId, referral_months: String(months) },
			},
			{ idempotencyKey },
		)
		balanceTransactionId = credit.id
	} catch (err) {
		// Release OUR claim so the next renewal retries. The claim stamp guards the
		// release: a concurrent apply's fresh claim is never overwritten. Rows left
		// claimed by a hard crash are recovered after the TTL instead.
		try {
			const release = await db
				.from("referral_credit_ledger")
				.update({ claimed_at: null })
				.in("id", rowIds)
				.eq("claimed_at", claimTs)
				.select("id")
			if (release.error) {
				console.error("[billing] failed to release referral credit claim", { workspaceId, releaseErr: release.error })
			}
		} catch (releaseErr) {
			console.error("[billing] failed to release referral credit claim", { workspaceId, releaseErr })
		}
		return applySkip("provider-error", err instanceof Error ? err.message : String(err))
	}

	// The confirming `invoice.paid` settles the ledger: `applied_at` is set ONLY
	// now (never at claim time), guarded by OUR claim stamp so concurrent applies
	// cannot settle each other's rows. Only rows actually settled decrement the
	// counter — after the provider credit exists the money is spent, so any
	// drift is logged (ledger rows stay the applied truth), never replayed.
	const settleTs = new Date().toISOString()
	const settled = unwrap<LedgerClaimRow[]>(
		await db
			.from("referral_credit_ledger")
			.update({ applied_at: settleTs, claimed_at: null })
			.in("id", rowIds)
			.eq("claimed_at", claimTs)
			.select("id, months"),
		"referral_credit_ledger",
	)
	const settledMonths = settled.reduce((total, row) => total + (Number(row.months) || 0), 0)
	if (settled.length < claimed.length) {
		console.error("[billing] referral credit settle incomplete after provider credit", {
			workspaceId,
			claimed: claimed.length,
			settled: settled.length,
		})
	}

	if (settledMonths > 0) {
		try {
			await adjustCreditedMonths(db, workspaceId, -settledMonths)
		} catch (err) {
			console.error("[billing] credited_months decrement failed after provider credit", { workspaceId, months: settledMonths, err })
		}
	}

	return { applied: true, reason: "applied", monthsApplied: settledMonths, creditMinorUnits, balanceTransactionId }
}

// ---------------------------------------------------------------------------
// Summary for the billing UI (US-10 AC2; T12(b) feed)
// ---------------------------------------------------------------------------

/**
 * Ledger summary of the workspace's referral credits for the billing settings
 * tab (T12(b)). PII-minimized by construction: stage/months/timestamps only —
 * invitee refs and user ids never leave the service.
 */
export async function getReferralSummary(db: SupabaseClient, workspaceId: string): Promise<ReferralSummary> {
	const plan = unwrap<{ credited_months: number | null } | null>(
		await db.from("workspace_plans").select("credited_months").eq("workspace_id", workspaceId).maybeSingle(),
		"workspace_plans",
	)
	const rows = unwrap<Array<{ trigger_stage: string; months: number; granted_at: string | null; applied_at: string | null }>>(
		await db
			.from("referral_credit_ledger")
			.select("trigger_stage, months, granted_at, applied_at")
			.eq("workspace_id", workspaceId)
			.order("granted_at", { ascending: false }),
		"referral_credit_ledger",
	)

	const summaryRows: ReferralSummaryRow[] = rows.map((row) => ({
		triggerStage: row.trigger_stage === "conversion" ? "conversion" : "activation",
		months: Number(row.months) || 0,
		grantedAt: row.granted_at ?? null,
		appliedAt: row.applied_at ?? null,
	}))

	let bankedMonths = 0
	let appliedMonths = 0
	let activationGrants = 0
	let conversionGrants = 0
	for (const row of summaryRows) {
		if (row.appliedAt) appliedMonths += row.months
		else bankedMonths += row.months
		if (row.triggerStage === "activation") activationGrants += 1
		else conversionGrants += 1
	}

	const bankCapMonths = referralBankCapMonths()
	return {
		workspaceId,
		creditedMonths: Number(plan?.credited_months ?? 0) || 0,
		bankedMonths,
		appliedMonths,
		lifetimeGrantedMonths: bankedMonths + appliedMonths,
		activationGrants,
		conversionGrants,
		bankCapMonths,
		capReached: bankedMonths >= bankCapMonths,
		rows: summaryRows,
	}
}
