import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * T10 — reconciliation cron service (plan T10; spec §6/§8; PRD US-7/US-12 AC2;
 * PDEC-2/3/7; TL B3).
 *
 * DoD pins (SIL-85):
 *  - missed-webhook drill: NO `gateway_events` rows, seeded divergent provider
 *    state ⇒ the cron converges (US-12 AC2);
 *  - a missed webhook while `past_due` either recovers (provider active ⇒ clock
 *    cleared) or expires correctly (terminal ⇒ free; still past_due ⇒ the D9 grace
 *    anchor is preserved, never silently reset);
 *  - no-op on already-converged state (idempotent cron; `last_checked_at` moves,
 *    state does not — including when Postgres' `+00:00` timestamptz formatting
 *    differs from the provider's `.000Z`);
 *  - referral ledger settlement only when a confirming paid invoice exists (T9),
 *    with the invoice window anchored on the grant.
 *
 * Hardening pins from the Stage-5 clean-room review: a provider 404 is
 * corroborated against the stored customer before it may terminalize (H1), a
 * referral failure does not advance the watermark (M2), read-back/apply failures
 * keep the row stale for retry (L2), and the production invoice lookup itself is
 * pinned against a mocked Stripe client (M5).
 *
 * All provider I/O is injected (no network, no real SDK client). The fake DB is an
 * in-memory PostgREST double covering exactly the chain surface this service and
 * T9's apply use.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { DEFAULT_RECONCILE_WATERMARK_MS, reconcileBilling } from "@/services/billing/reconciliation"
import type { SubscriptionReadBack } from "@/services/billing/webhook-processor"
import { applyCreditsAtRenewal, type ApplyCreditsResult } from "@/services/billing/referral-credits"

// ---------------------------------------------------------------------------
// In-memory PostgREST double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type Store = Record<string, Row[]>
type FakeError = { code?: string; message?: string }

type Op =
	| { kind: "read" }
	| { kind: "insert"; row: Row }
	| { kind: "update"; patch: Row }
	| { kind: "upsert"; patch: Row; onConflict: string | null }

const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value) as string)

class Chain implements PromiseLike<{ data: Row[] | null; error: FakeError | null }> {
	private filters: Array<(row: Row) => boolean> = []
	private cols = "*"
	private ordering: { col: string; ascending: boolean; nullsFirst: boolean } | null = null
	private limitN: number | null = null
	private op: Op = { kind: "read" }

	constructor(
		private readonly store: Store,
		private readonly table: string,
	) {}

	select(cols?: string): this {
		this.cols = cols ?? "*"
		return this
	}

	insert(row: Row): this {
		this.op = { kind: "insert", row }
		return this
	}

	update(patch: Row): this {
		this.op = { kind: "update", patch }
		return this
	}

	upsert(patch: Row, opts?: { onConflict?: string }): this {
		this.op = { kind: "upsert", patch, onConflict: opts?.onConflict ?? null }
		return this
	}

	eq(col: string, val: unknown): this {
		this.filters.push((row) => row[col] === val)
		return this
	}

	neq(col: string, val: unknown): this {
		this.filters.push((row) => row[col] !== val)
		return this
	}

	is(col: string, val: null): this {
		// PostgREST/Postgres treat an absent column as NULL.
		this.filters.push((row) => (row[col] ?? null) === val)
		return this
	}

	lt(col: string, val: unknown): this {
		this.filters.push((row) => row[col] != null && String(row[col]) < String(val))
		return this
	}

	in(col: string, vals: unknown[]): this {
		this.filters.push((row) => vals.includes(row[col]))
		return this
	}

	/** Narrow `or` support for the watermark predicate the service issues. */
	or(expr: string): this {
		const clauses = expr.split(",").map((clause) => clause.trim())
		this.filters.push((row) =>
			clauses.some((clause) => {
				if (clause.endsWith(".is.null")) {
					const col = clause.slice(0, -".is.null".length)
					return (row[col] ?? null) === null
				}
				const lessThan = clause.match(/^(.*)\.lt\.(.*)$/)
				if (lessThan) {
					const [, col, value] = lessThan
					return row[col] != null && String(row[col]) < value
				}
				throw new Error(`fake DB: unsupported or clause "${clause}"`)
			}),
		)
		return this
	}

	order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
		this.ordering = { col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false }
		return this
	}

	limit(n: number): this {
		this.limitN = n
		return this
	}

	maybeSingle(): Promise<{ data: Row | null; error: FakeError | null }> {
		return this.exec().then((res) => ({ data: res.error ? null : (res.data?.[0] ?? null), error: res.error }))
	}

	private matched(): Row[] {
		let rows = (this.store[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
		if (this.ordering) {
			const { col, ascending, nullsFirst } = this.ordering
			rows = [...rows].sort((a, b) => {
				const av = a[col] ?? null
				const bv = b[col] ?? null
				if (av === null && bv === null) return 0
				if (av === null) return nullsFirst ? -1 : 1
				if (bv === null) return nullsFirst ? 1 : -1
				return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
			})
		}
		if (this.limitN !== null) rows = rows.slice(0, this.limitN)
		return rows
	}

	private project(rows: Row[]): Row[] {
		if (this.cols === "*") return rows.map((row) => clone(row) as Row)
		const keys = this.cols.split(/[,\s]+/).filter(Boolean)
		return rows.map((row) => {
			const out: Row = {}
			for (const key of keys) if (key in row) out[key] = clone(row[key])
			return out
		})
	}

	private exec(): Promise<{ data: Row[] | null; error: FakeError | null }> {
		if (this.op.kind === "insert") {
			const row = { id: `gen-${(this.store[this.table] ??= []).length + 1}`, ...(clone(this.op.row) as Row) }
			this.store[this.table].push(row)
			return Promise.resolve({ data: this.project([row]), error: null })
		}
		if (this.op.kind === "update") {
			const targets = this.matched()
			for (const row of targets) Object.assign(row, clone(this.op.patch) as Row)
			return Promise.resolve({ data: this.project(targets), error: null })
		}
		if (this.op.kind === "upsert") {
			const { patch, onConflict } = this.op
			const existing = onConflict
				? (this.store[this.table] ?? []).find((row) => row[onConflict] === patch[onConflict])
				: undefined
			if (existing) {
				Object.assign(existing, clone(patch) as Row)
				return Promise.resolve({ data: this.project([existing]), error: null })
			}
			const row = clone(patch) as Row
			;(this.store[this.table] ??= []).push(row)
			return Promise.resolve({ data: this.project([row]), error: null })
		}
		return Promise.resolve({ data: this.project(this.matched()), error: null })
	}

	then<TF = { data: Row[] | null; error: FakeError | null }, TR = never>(
		onfulfilled?: ((value: { data: Row[] | null; error: FakeError | null }) => TF | PromiseLike<TF>) | null,
		onrejected?: ((reason: unknown) => TR | PromiseLike<TF | TR>) | null,
	): PromiseLike<TF | TR> {
		return this.exec().then(onfulfilled, onrejected)
	}
}

type FakeDb = SupabaseClient & { touched: Set<string> }

function fakeDb(store: Store): FakeDb {
	const touched = new Set<string>()
	return {
		from: (table: string) => {
			touched.add(table)
			return new Chain(store, table)
		},
		touched,
	} as unknown as FakeDb
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS = "11111111-1111-4111-8111-111111111111"
const OWNER = "22222222-2222-4222-8222-222222222222"
const SUB = "sub_recon_001"
const CUSTOMER = "cus_recon_001"

const NOW = new Date("2026-10-27T04:30:00.000Z")
const OLD_CHECK = "2026-10-20T04:30:00.000Z"
const OLD_GRACE = "2026-10-19T04:30:00.000Z" // 8 days before NOW ⇒ grace expired under D9

function planRow(over: Partial<Row> = {}): Row {
	return {
		workspace_id: WS,
		tier: "plus",
		billing_cycle: "monthly",
		gateway: "stripe",
		gateway_customer_id: CUSTOMER,
		gateway_subscription_id: SUB,
		currency: "USD",
		is_founding: false,
		seats: 1,
		status: "active",
		current_period_end: "2026-12-01T00:00:00.000Z",
		credited_months: 0,
		cancel_at_period_end: false,
		past_due_since: null,
		last_checked_at: OLD_CHECK,
		updated_at: OLD_CHECK,
		...over,
	}
}

function ledgerRow(over: Partial<Row> = {}): Row {
	return {
		id: `ledger-${Math.random().toString(36).slice(2)}`,
		workspace_id: WS,
		referrer_user_id: OWNER,
		source_ref: OWNER,
		invitee_ref: "invitee-a",
		invitee_user_id: "invitee-a",
		trigger_stage: "activation",
		months: 1,
		granted_at: "2026-10-01T00:00:00.000Z",
		applied_at: null,
		claimed_at: null,
		...over,
	}
}

function seedStore(over: { plan?: Partial<Row>; profiles?: Row[]; ledger?: Row[] } = {}): Store {
	return {
		workspaces: [{ id: WS, owner_id: OWNER }],
		profiles: over.profiles ?? [{ id: OWNER, plan: "free", email: "owner@example.com" }],
		workspace_plans: [planRow(over.plan)],
		gateway_events: [],
		referral_credit_ledger: over.ledger ?? [],
	}
}

function readBack(over: Partial<SubscriptionReadBack> = {}): SubscriptionReadBack {
	return {
		subscriptionRef: SUB,
		customerRef: CUSTOMER,
		workspaceId: WS,
		status: "active",
		cancelAtPeriodEnd: false,
		currentPeriodEnd: "2026-12-01T00:00:00.000Z",
		tier: "plus",
		cycle: "monthly",
		isFounding: false,
		seats: 1,
		...over,
	}
}

const NO_CREDITS_APPLIED = {
	applied: false,
	reason: "nothing-banked" as const,
	monthsApplied: 0,
	creditMinorUnits: 0,
	balanceTransactionId: null,
}

function setup(
	opts: {
		store?: Store
		state?: SubscriptionReadBack
		invoice?: { invoiceId: string; paidAt: string } | null
		customerPresent?: boolean
	} = {},
) {
	const store = opts.store ?? seedStore()
	const readSubscription = vi.fn(async (): Promise<SubscriptionReadBack | null> => opts.state ?? readBack())
	const customerExists = vi.fn(async () => opts.customerPresent ?? true)
	const findConfirmingInvoice = vi.fn(async (): Promise<{ invoiceId: string; paidAt: string } | null> => opts.invoice ?? null)
	const applyCredits = vi.fn(async (): Promise<ApplyCreditsResult> => NO_CREDITS_APPLIED)
	return { store, db: fakeDb(store), readSubscription, customerExists, findConfirmingInvoice, applyCredits }
}

// ---------------------------------------------------------------------------
// Missed-webhook drill (US-12 AC2)
// ---------------------------------------------------------------------------

describe("reconciliation cron — missed-webhook convergence (US-12 AC2)", () => {
	it("converges a divergent entitlement from provider truth with zero gateway_events rows", async () => {
		// Nobody ever delivered a webhook: the audit table is empty, the provider
		// says past_due with a new period, the DB still says active.
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			state: readBack({ status: "past_due", currentPeriodEnd: "2026-11-15T00:00:00.000Z" }),
		})

		const summary = await reconcileBilling({
			db,
			now: () => NOW,
			readSubscription,
			customerExists,
			findConfirmingInvoice,
			applyCredits,
		})

		expect(summary).toMatchObject({ scanned: 1, checked: 1, converged: 1, failures: 0, gone: 0 })
		// The cron never manufactures webhook evidence — it converges without one.
		expect(db.touched.has("gateway_events")).toBe(false)
		expect(store.gateway_events).toHaveLength(0)

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("past_due")
		expect(plan.past_due_since).toBe(NOW.toISOString())
		expect(plan.current_period_end).toBe("2026-11-15T00:00:00.000Z")
		expect(plan.last_checked_at).toBe(NOW.toISOString())
		// Deprecated mirror converges with the entitlement (never a stale plan string).
		expect(store.profiles[0].plan).toBe("plus")
	})

	it("converges a missed terminal cancellation to free and restores the mirror", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			state: readBack({ status: "canceled", currentPeriodEnd: null }),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.converged).toBe(1)
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
		expect(plan.billing_cycle).toBe("none")
		expect(plan.cancel_at_period_end).toBe(false)
		expect(plan.past_due_since).toBeNull()
		expect(store.profiles[0].plan).toBe("free")
	})

	it("treats a provider-deleted subscription as terminal once the customer is corroborated", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup()
		const { SubscriptionNotFoundError } = await import("@/lib/billing/gateway")
		readSubscription.mockReset()
		readSubscription.mockRejectedValueOnce(new SubscriptionNotFoundError(SUB))

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.gone).toBe(1)
		expect(customerExists).toHaveBeenCalledWith("stripe", CUSTOMER)
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
		expect(plan.gateway_customer_id).toBe(CUSTOMER) // resubscribe still reuses the customer
		expect(plan.gateway_subscription_id).toBe(SUB)
	})

	it("refuses to terminalize on a 404 when the customer binding is gone too (wrong key/account)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({ customerPresent: false })
		const { SubscriptionNotFoundError } = await import("@/lib/billing/gateway")
		readSubscription.mockReset()
		readSubscription.mockRejectedValueOnce(new SubscriptionNotFoundError(SUB))

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary).toMatchObject({ failures: 1, gone: 0, converged: 0 })
		expect(summary.results[0]).toMatchObject({ outcome: "provider-error", detail: "provider account mismatch (customer not found)" })
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("active") // never mass-downgrade on a config fault
		expect(plan.tier).toBe("plus")
		expect(plan.last_checked_at).toBe(OLD_CHECK) // stays stale for the next run
		expect(store.profiles[0].plan).toBe("free") // mirror untouched
	})

	it("refuses to terminalize a 404 without a stored customer binding", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { gateway_customer_id: null } }),
		})
		const { SubscriptionNotFoundError } = await import("@/lib/billing/gateway")
		readSubscription.mockReset()
		readSubscription.mockRejectedValueOnce(new SubscriptionNotFoundError(SUB))

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.failures).toBe(1)
		expect(customerExists).not.toHaveBeenCalled()
		expect(store.workspace_plans[0].tier).toBe("plus")
	})
})

// ---------------------------------------------------------------------------
// D9 grace: recovery vs expiry
// ---------------------------------------------------------------------------

describe("reconciliation cron — past_due grace (D9)", () => {
	it("recovers a missed recovery: provider active ⇒ clears the grace clock", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { status: "past_due", past_due_since: OLD_GRACE } }),
			state: readBack({ status: "active", currentPeriodEnd: "2026-11-20T00:00:00.000Z" }),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.converged).toBe(1)
		expect(store.workspace_plans[0].status).toBe("active")
		expect(store.workspace_plans[0].past_due_since).toBeNull()
		expect(store.profiles[0].plan).toBe("plus")
	})

	it("expires correctly: provider terminal ⇒ free; still past_due ⇒ grace anchor is never reset", async () => {
		// (a) terminal expiry
		const terminal = setup({
			store: seedStore({ plan: { status: "past_due", past_due_since: OLD_GRACE } }),
			state: readBack({ status: "canceled", currentPeriodEnd: null }),
		})
		await reconcileBilling({
			db: terminal.db,
			now: () => NOW,
			readSubscription: terminal.readSubscription,
			customerExists: terminal.customerExists,
			findConfirmingInvoice: terminal.findConfirmingInvoice,
			applyCredits: terminal.applyCredits,
		})
		expect(terminal.store.workspace_plans[0].status).toBe("canceled")
		expect(terminal.store.workspace_plans[0].tier).toBe("free")
		expect(terminal.store.workspace_plans[0].past_due_since).toBeNull()

		// (b) grace already elapsed but the provider still reports past_due: the
		// clock must survive reconciliation (T11 reads it to gate the relay).
		const lingering = setup({
			store: seedStore({ plan: { status: "past_due", past_due_since: OLD_GRACE } }),
			state: readBack({ status: "past_due" }),
		})
		const summary = await reconcileBilling({
			db: lingering.db,
			now: () => NOW,
			readSubscription: lingering.readSubscription,
			customerExists: lingering.customerExists,
			findConfirmingInvoice: lingering.findConfirmingInvoice,
			applyCredits: lingering.applyCredits,
		})
		expect(summary.failures).toBe(0)
		expect(lingering.store.workspace_plans[0].status).toBe("past_due")
		expect(lingering.store.workspace_plans[0].past_due_since).toBe(OLD_GRACE)
		expect(lingering.store.profiles[0].plan).toBe("plus") // past_due is still entitled during grace
	})
})

// ---------------------------------------------------------------------------
// Idempotency + watermark
// ---------------------------------------------------------------------------

describe("reconciliation cron — idempotent convergence", () => {
	it("no-ops on already-converged state (state unchanged; only the watermark moves)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup()

		const first = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })
		expect(first).toMatchObject({ checked: 1, unchanged: 1, converged: 0, failures: 0 })
		const snapshot = { ...store.workspace_plans[0] }

		const later = new Date(NOW.getTime() + 60 * 60 * 1000)
		const second = await reconcileBilling({ db, now: () => later, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(second).toMatchObject({ checked: 1, unchanged: 1, converged: 0, failures: 0 })
		const after = store.workspace_plans[0]
		expect(after.tier).toBe(snapshot.tier)
		expect(after.status).toBe(snapshot.status)
		expect(after.current_period_end).toBe(snapshot.current_period_end)
		expect(after.past_due_since).toBe(snapshot.past_due_since)
		expect(after.credited_months).toBe(snapshot.credited_months)
		expect(after.last_checked_at).toBe(later.toISOString())
		expect(db.touched.has("gateway_events")).toBe(false)
	})

	it("treats Postgres timestamptz formatting (stored +00:00) as equal to the provider's .000Z", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { current_period_end: "2026-12-01T00:00:00+00:00" } }),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary).toMatchObject({ unchanged: 1, converged: 0 })
		expect(store.workspace_plans[0].updated_at).toBe(OLD_CHECK) // no churn upsert
	})

	it("skips rows inside the last_checked_at watermark without touching the provider", async () => {
		const fresh = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { last_checked_at: fresh } }),
		})

		const summary = await reconcileBilling({
			db,
			now: () => NOW,
			watermarkMs: DEFAULT_RECONCILE_WATERMARK_MS,
			readSubscription,
			customerExists,
			findConfirmingInvoice,
			applyCredits,
		})

		// The watermark predicate is in the work-list query: fresh rows are not even
		// returned (and `skippedFresh` only exists as an in-memory race guard).
		expect(summary).toMatchObject({ scanned: 0, checked: 0, failures: 0 })
		expect(readSubscription).not.toHaveBeenCalled()
		expect(store.workspace_plans[0].last_checked_at).toBe(fresh)
	})

	it("ignores free workspaces (gateway = none) entirely", async () => {
		const { db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({
				plan: { gateway: "none", gateway_subscription_id: null, gateway_customer_id: null, tier: "free", billing_cycle: "none", status: "none" },
			}),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.scanned).toBe(0)
		expect(readSubscription).not.toHaveBeenCalled()
	})

	it("keeps a failed row stale so the next run retries it (read-back failure ⇒ no watermark advance)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup()
		readSubscription.mockRejectedValueOnce(new Error("provider down"))

		const failed = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })
		expect(failed.failures).toBe(1)
		expect(store.workspace_plans[0].last_checked_at).toBe(OLD_CHECK)

		const retried = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })
		expect(retried).toMatchObject({ checked: 1, unchanged: 1, failures: 0 })
	})

	it("fails loudly without writing when the stored plan cannot be price-mapped (config fault)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { tier: "free", billing_cycle: "none" } }),
			state: readBack({ tier: null, cycle: null }),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.failures).toBe(1)
		expect(summary.results[0].outcome).toBe("config-error")
		expect(store.workspace_plans[0].tier).toBe("free")
		expect(store.workspace_plans[0].status).toBe("active") // untouched
		expect(store.workspace_plans[0].last_checked_at).toBe(OLD_CHECK)
		expect(store.profiles[0].plan).toBe("free")
	})
})

// ---------------------------------------------------------------------------
// Referral ledger settlement (T9 seam)
// ---------------------------------------------------------------------------

describe("reconciliation cron — referral ledger settlement (T9)", () => {
	const ENV_KEYS = ["STRIPE_PRICE_PLUS_MONTHLY_GA_USD", "STRIPE_PRICE_PRO_MONTHLY_GA_USD"] as const
	const saved: Record<string, string | undefined> = {}

	beforeEach(() => {
		for (const key of ENV_KEYS) saved[key] = process.env[key]
		process.env.STRIPE_PRICE_PLUS_MONTHLY_GA_USD = "price_plus_monthly_ga"
		process.env.STRIPE_PRICE_PRO_MONTHLY_GA_USD = "price_pro_monthly_ga"
	})

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
	})

	function creditStub() {
		const create = vi.fn(async () => ({ id: "bt_recon_1" }))
		return { client: { customers: { createBalanceTransaction: create } }, create }
	}

	it("does NOT settle banked months without a confirming paid invoice", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({
				plan: { credited_months: 2 },
				ledger: [ledgerRow({ invitee_ref: "a" }), ledgerRow({ invitee_ref: "b", trigger_stage: "conversion" })],
			}),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary).toMatchObject({ referralsSettled: 0, failures: 0 })
		expect(summary.results[0].referral).toBe("no-confirming-invoice")
		expect(applyCredits).not.toHaveBeenCalled()
		for (const row of store.referral_credit_ledger) {
			expect(row.applied_at).toBeNull()
			expect(row.claimed_at).toBeNull()
		}
		expect(store.workspace_plans[0].credited_months).toBe(2)
		// The invoice lookup is anchored on the earliest unapplied grant.
		expect(findConfirmingInvoice).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceId: WS, customerRef: CUSTOMER, subscriptionRef: SUB, since: "2026-10-01T00:00:00.000Z" }),
		)
	})

	it("anchors the invoice window on the grant, never on an older watermark", async () => {
		const { db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({
				// watermark is OLDER than the grant: an invoice before the grant cannot
				// confirm a month that did not exist yet.
				plan: { last_checked_at: "2026-09-01T00:00:00.000Z" },
				ledger: [ledgerRow({ granted_at: "2026-10-01T00:00:00.000Z" })],
			}),
		})

		await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(findConfirmingInvoice).toHaveBeenCalledWith(expect.objectContaining({ since: "2026-10-01T00:00:00.000Z" }))
	})

	it("settles banked months through T9 when a confirming paid invoice exists", async () => {
		const store = seedStore({
			plan: { credited_months: 2 },
			ledger: [ledgerRow({ invitee_ref: "a" }), ledgerRow({ invitee_ref: "b", trigger_stage: "conversion" })],
		})
		const { create, client } = creditStub()
		const db = fakeDb(store)

		const summary = await reconcileBilling({
			db,
			now: () => NOW,
			watermarkMs: 0,
			readSubscription: async () => readBack(),
			customerExists: async () => true,
			findConfirmingInvoice: async () => ({ invoiceId: "in_recon_paid", paidAt: "2026-10-26T00:00:00.000Z" }),
			applyCredits: (clientDb, workspaceId) => applyCreditsAtRenewal(clientDb, workspaceId, { stripe: client as never }),
		})

		expect(summary).toMatchObject({ referralsSettled: 1, failures: 0 })
		expect(summary.results[0].referral).toBe("settled")
		expect(create).toHaveBeenCalledTimes(1)
		// 2 banked months × plus monthly GA $6.00, applied as a negative (credit) amount.
		expect(create).toHaveBeenCalledWith(CUSTOMER, expect.objectContaining({ amount: -1200, currency: "usd" }), expect.any(Object))
		for (const row of store.referral_credit_ledger) {
			// T9's settle stamp is wall-clock (its apply seam has no injected clock).
			expect(typeof row.applied_at).toBe("string")
			expect(row.claimed_at).toBeNull()
		}
		expect(store.workspace_plans[0].credited_months).toBe(0)
	})

	it("does not advance the watermark when settlement fails, so a manual re-run retries (M2)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({ plan: { credited_months: 1 }, ledger: [ledgerRow()] }),
			invoice: { invoiceId: "in_recon_paid", paidAt: "2026-10-26T00:00:00.000Z" },
		})
		applyCredits.mockResolvedValueOnce({ applied: false, reason: "provider-error", monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null, detail: "stripe 500" })

		const failed = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })
		expect(failed.failures).toBe(1)
		expect(failed.results[0]).toMatchObject({ referral: "provider-error", detail: "referral settlement failed" })
		expect(store.workspace_plans[0].last_checked_at).toBe(OLD_CHECK)
		expect(store.referral_credit_ledger[0].applied_at).toBeNull()

		const retried = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })
		expect(retried).toMatchObject({ checked: 1, failures: 0 })
		expect(applyCredits).toHaveBeenCalledTimes(2)
	})

	it("never attempts INR redemption — Razorpay credits bank only (PDEC-2)", async () => {
		const { store, db, readSubscription, customerExists, findConfirmingInvoice, applyCredits } = setup({
			store: seedStore({
				plan: { gateway: "razorpay", currency: "INR", gateway_subscription_id: "sub_rzp_1", credited_months: 1 },
				ledger: [ledgerRow()],
			}),
			state: readBack({ subscriptionRef: "sub_rzp_1", customerRef: null, tier: "plus", cycle: "monthly" }),
		})

		const summary = await reconcileBilling({ db, now: () => NOW, watermarkMs: 0, readSubscription, customerExists, findConfirmingInvoice, applyCredits })

		expect(summary.results[0].referral).toBe("not-stripe")
		expect(findConfirmingInvoice).not.toHaveBeenCalled()
		expect(applyCredits).not.toHaveBeenCalled()
		expect(store.referral_credit_ledger[0].applied_at).toBeNull()
		expect(store.workspace_plans[0].credited_months).toBe(1)
	})

	it("default invoice lookup asks Stripe for paid invoices on the subscription since the grant (M5)", async () => {
		const list = vi.fn(async () => ({
			data: [
				{
					id: "in_default_paid",
					status: "paid",
					created: 1_790_000_000,
					status_transitions: { paid_at: 1_790_000_100 },
				},
			],
		}))
		vi.resetModules()
		vi.doMock("@/lib/billing/stripe", () => ({
			getStripeClient: () => ({ invoices: { list } }),
		}))

		try {
			const { reconcileBilling: freshReconcile } = await import("@/services/billing/reconciliation")
			const store = seedStore({ ledger: [ledgerRow()] })
			const db = fakeDb(store)

			const summary = await freshReconcile({
				db,
				now: () => NOW,
				watermarkMs: 0,
				readSubscription: async () => readBack(),
				customerExists: async () => true,
				// The default findConfirmingInvoice is under test — do not inject it.
				applyCredits: async () => ({ applied: true, reason: "applied", monthsApplied: 1, creditMinorUnits: 600, balanceTransactionId: "bt_x" }),
			})

			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "paid",
					subscription: SUB,
					created: { gte: Math.floor(Date.parse("2026-10-01T00:00:00.000Z") / 1000) },
				}),
			)
			expect(summary).toMatchObject({ referralsSettled: 1, failures: 0 })
		} finally {
			vi.doUnmock("@/lib/billing/stripe")
			vi.resetModules()
		}
	})
})
