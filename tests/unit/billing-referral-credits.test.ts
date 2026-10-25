import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"

/**
 * T9 — referral credits service (plan T9 / spec §4.3 + §8 / PRD US-10 + US-11).
 *
 * DoD pins (SIL-83 verbatim):
 *  - per-stage dedup honored (an activation row never blocks the conversion row;
 *    a second conversion row for the same invitee is deduped)
 *  - bank cap blocks grants beyond 12 (`BILLING_REFERRAL_BANK_CAP_MONTHS`, config)
 *  - Stripe apply idempotency: double `invoice.paid` ⇒ a single provider credit
 *    and a single `credited_months` decrement (PDEC-3)
 *  - Razorpay grants bank WITHOUT any redemption attempt (PDEC-2)
 *  - US-11 AC2: credits remain banked and unaffected by plan changes
 *  - provider calls mocked at the HTTP/client seam; no network, no real client.
 *
 * Extra pins owned by this slice: self-referral blocked at attribution match-time
 * (same user id / same email), invalid refs grant nothing, deferred conversion
 * grants (PDEC-4 pre-existing-workspace case) resolve + bump exactly once when the
 * referrer's workspace materializes, team seat multiplication (PDEC-3), founding
 * cohort pricing on the credit amount, annual billing cycles credit at the
 * same-cohort MONTHLY tier value (US-11 AC1 — cycle 1 clean-room fix), the
 * `claimed_at` claim/isolated-settle semantics with TTL recovery (cycle 1 fix),
 * the credited_months CAS discipline against the concurrent T3 trigger bump, and
 * `getReferralSummary` for the T12(b) UI.
 *
 * PDEC-4 reconciliation: the activation-stage counter bump stays owned by the T3
 * workspaces-INSERT trigger (this service never bumps for activation rows). Conversion rows are
 * written only by this service, so their bump is the service's own insert-guarded
 * write. Since the T9-rev resolver migration the trigger's deferred resolver
 * attaches EITHER stage, and both writers only ever touch rows still
 * attachment-pending (`workspace_id IS NULL`) — a row is attached + bumped
 * exactly once whoever gets there first.
 */

const ENV_KEYS = [
	"BILLING_REFERRAL_BANK_CAP_MONTHS",
	"STRIPE_SECRET_KEY",
	"STRIPE_PRICE_PRO_MONTHLY_GA_USD",
	"STRIPE_PRICE_PLUS_MONTHLY_GA_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_GA_USD",
	"STRIPE_PRICE_PRO_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PRO_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_PRO_ANNUAL_GA_USD",
] as const

const saved: Record<string, string | undefined> = {}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REFERRER = "aaaaaaaa-0000-4000-8000-000000000000"
const INVITEE_A = "bbbbbbbb-0000-4000-8000-000000000000"
const INVITEE_B = "cccccccc-0000-4000-8000-000000000000"
const INVITEE_C = "dddddddd-0000-4000-8000-000000000000" // same email as the referrer
const WS_REFERRER = "eeeeeeee-0000-4000-8000-000000000000"
const WS_A = "ffffffff-0000-4000-8000-000000000000"
const WS_B = "00000000-1111-4111-8111-000000000000"
const WS_C = "00000000-2222-4222-8222-000000000000"

const REFERRER_EMAIL = "P4.founder@Example.com"
const md5Lower = (email: string) => createHash("md5").update(email.toLowerCase()).digest("hex")

let autoId = 0
const nextId = () => `row-${++autoId}`

type Row = Record<string, unknown>
type Store = Record<string, Row[]>

interface FakeError {
	code: string
	message: string
}

type Op = {
	kind: "insert"
	row: Row
} | {
	kind: "update"
	patch: Row
} | {
	kind: "read"
}

const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown

/**
 * Minimal in-memory PostgREST double: supports exactly the chain surface the
 * service uses (select/eq/is/in/order/limit/maybeSingle/insert/update + await
 * resolution) with column projection, and enforces the T3 ledger uniques so
 * dedup is proven against a real conflict, not just a pre-check.
 */
class Chain implements PromiseLike<{ data: Row[] | Row | null; error: FakeError | null }> {
	private filters: Array<(row: Row) => boolean> = []
	private cols: string = "*"
	private orderDesc: string | null = null
	private orderAsc: string | null = null
	private limitN: number | null = null
	private op: Op = { kind: "read" }

	constructor(private readonly store: Store, private readonly table: string) {}

	select(cols?: string): this {
		this.cols = cols ?? "*"
		return this
	}

	insert(payload: Row): this {
		this.op = { kind: "insert", row: payload }
		return this
	}

	update(patch: Row): this {
		this.op = { kind: "update", patch }
		return this
	}

	eq(col: string, val: unknown): this {
		this.filters.push((row) => row[col] === val)
		return this
	}

	is(col: string, val: null): this {
		// PostgREST/Postgres see an absent column as NULL — mirror that.
		this.filters.push((row) => (row[col] ?? null) === val)
		return this
	}

	/** Strictly-less filter; ISO timestamps order lexicographically. */
	lt(col: string, val: unknown): this {
		this.filters.push((row) => row[col] != null && String(row[col]) < String(val))
		return this
	}

	in(col: string, vals: unknown[]): this {
		this.filters.push((row) => vals.includes(row[col]))
		return this
	}

	order(col: string, opts?: { ascending?: boolean }): this {
		if (opts?.ascending === false) this.orderDesc = col
		else this.orderAsc = col
		return this
	}

	limit(n: number): this {
		this.limitN = n
		return this
	}

	maybeSingle(): Promise<{ data: Row | null; error: FakeError | null }> {
		return this.exec().then((res) => ({
			data: res.error ? null : ((res.data as Row[])[0] ?? null),
			error: res.error,
		}))
	}

	private matched(): Row[] {
		let rows = (this.store[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)))
		if (this.orderDesc) {
			const col = this.orderDesc
			rows = [...rows].sort((a, b) => String(b[col]).localeCompare(String(a[col])))
		}
		if (this.orderAsc) {
			const col = this.orderAsc
			rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
		}
		if (this.limitN !== null) rows = rows.slice(0, this.limitN)
		return rows
	}

	private project(rows: Row[]): Row[] {
		if (this.cols === "*") return rows.map((r) => clone(r) as Row)
		const keys = this.cols.split(/[,\s]+/).filter(Boolean)
		return rows.map((r) => {
			const out: Row = {}
			for (const key of keys) if (key in r) out[key] = clone(r[key])
			return out
		})
	}

	private conflict(): FakeError | null {
		if (this.op.kind !== "insert") return null
		const row = this.op.row
		if (this.table === "referral_credit_ledger") {
			// UNIQUE (workspace_id, invitee_ref, trigger_stage) — Postgres NULLs escape it…
			const full = this.store["referral_credit_ledger"].some(
				(existing) =>
					existing.workspace_id != null &&
					existing.workspace_id === row.workspace_id &&
					existing.invitee_ref === row.invitee_ref &&
					existing.trigger_stage === row.trigger_stage,
			)
			if (full) return { code: "23505", message: "duplicate key value (workspace_invitee_stage)" }
			// …so the T3 partial UNIQUE (invitee_ref, trigger_stage) WHERE workspace_id IS NULL
			// is the arbiter for deferred rows.
			if (row.workspace_id == null) {
				const partial = this.store["referral_credit_ledger"].some(
					(existing) =>
						existing.workspace_id == null &&
						existing.invitee_ref === row.invitee_ref &&
						existing.trigger_stage === row.trigger_stage,
				)
				if (partial) return { code: "23505", message: "duplicate key value (deferred partial unique)" }
			}
			return null
		}
		if (this.table === "workspace_plans") {
			const dup = this.store["workspace_plans"].some((r) => r.workspace_id === row.workspace_id)
			if (dup) return { code: "23505", message: "duplicate key value (workspace_plans pk)" }
		}
		return null
	}

	private exec(): Promise<{ data: Row[] | Row | null; error: FakeError | null }> {
		if (this.op.kind === "insert") {
			const err = this.conflict()
			if (err) return Promise.resolve({ data: null, error: err })
			const row: Row = { id: nextId(), ...(JSON.parse(JSON.stringify(this.op.row)) as Row) }
			;(this.store[this.table] ??= []).push(row)
			return Promise.resolve({ data: this.project([row]), error: null })
		}
		if (this.op.kind === "update") {
			const targets = this.matched()
			for (const row of targets) Object.assign(row, JSON.parse(JSON.stringify(this.op.patch)) as Row)
			return Promise.resolve({ data: this.project(targets), error: null })
		}
		return Promise.resolve({ data: this.project(this.matched()), error: null })
	}

	then<TF = { data: Row[] | Row | null; error: FakeError | null }, TR = never>(
		onfulfilled?: ((value: { data: Row[] | Row | null; error: FakeError | null }) => TF | PromiseLike<TF>) | null,
		onrejected?: ((reason: unknown) => TR | PromiseLike<TR>) | null,
	): PromiseLike<TF | TR> {
		return this.exec().then(onfulfilled, onrejected)
	}
}

function fakeDb(store: Store) {
	return {
		from: (table: string) => new Chain(store, table),
	}
}

// Row factories -------------------------------------------------------------

function ledgerRow(over: Partial<Row> = {}): Row {
	return {
		id: nextId(),
		workspace_id: WS_REFERRER,
		referrer_user_id: REFERRER,
		source_ref: REFERRER,
		invitee_ref: INVITEE_A,
		invitee_user_id: INVITEE_A,
		trigger_stage: "activation",
		months: 1,
		granted_at: new Date(1_760_000_000_000).toISOString(),
		applied_at: null,
		claimed_at: null,
		...over,
	}
}

interface SeedOpts {
	/** Include the referrer's workspace + billing root (default true). */
	withReferrerWorkspace?: boolean
	/** Include the billing root row when the workspace is present (default true). */
	withPlan?: boolean
	attribution?: Row[]
	ledger?: Row[]
	plan?: Row
}

const REFERRER_PLAN_BASE: Row = {
	workspace_id: WS_REFERRER,
	tier: "free",
	billing_cycle: "none",
	gateway: "none",
	gateway_customer_id: null,
	gateway_subscription_id: null,
	currency: null,
	is_founding: false,
	seats: null,
	status: "none",
	credited_months: 0,
}

function seedStore(opts: SeedOpts = {}): Store {
	const withWs = opts.withReferrerWorkspace !== false
	const store: Store = {
		workspaces: [
			{ id: WS_A, owner_id: INVITEE_A },
			{ id: WS_B, owner_id: INVITEE_B },
			{ id: WS_C, owner_id: INVITEE_C },
		],
		profiles: [
			{ id: REFERRER, email: REFERRER_EMAIL },
			{ id: INVITEE_A, email: "a@example.com" },
			{ id: INVITEE_B, email: "b@example.com" },
			{ id: INVITEE_C, email: REFERRER_EMAIL.toLowerCase() },
		],
		referral_attribution: (opts.attribution ?? [
			{ user_id: INVITEE_A, ref: REFERRER, email_hash: md5Lower("a@example.com") },
			{ user_id: INVITEE_B, ref: REFERRER, email_hash: md5Lower("b@example.com") },
			{ user_id: INVITEE_C, ref: REFERRER, email_hash: md5Lower(REFERRER_EMAIL) },
		]).map((r) => ({ ...r })),
		referral_credit_ledger: (opts.ledger ?? []).map((r) => ({ ...r })),
		workspace_plans: [],
	}
	if (withWs) {
		store.workspaces.unshift({ id: WS_REFERRER, owner_id: REFERRER })
		if (opts.withPlan !== false) {
			store.workspace_plans.push(opts.plan ? { ...REFERRER_PLAN_BASE, ...opts.plan } : { ...REFERRER_PLAN_BASE })
		}
	} else if (opts.plan) {
		store.workspace_plans.push({ ...REFERRER_PLAN_BASE, ...opts.plan })
	}
	return store
}

async function importService() {
	return import("@/services/billing/referral-credits")
}

function creditStub(result: { id: string } = { id: "bt_credit_1" }) {
	const create = vi.fn(async () => result)
	return { client: { customers: { createBalanceTransaction: create } }, create }
}

/**
 * Simulates the T3 activation-trigger bump landing BETWEEN the service's
 * `credited_months` read and its guarded CAS update: the row moves under the
 * reader, so the first CAS attempt misses its preimage and must re-read + retry.
 * With `every` (default false) each CAS read bumps too — every attempt misses,
 * exercising the retry-exhaustion path.
 */
function triggerBumpDb(store: Store, every = false) {
	const base = fakeDb(store)
	let bumped = false
	return {
		from: (table: string) => {
			const chain = base.from(table)
			if (table === "workspace_plans" && (!bumped || every)) {
				const orig = chain.maybeSingle.bind(chain)
				chain.maybeSingle = async () => {
					const res = await orig()
					if (!every && bumped) return res
					bumped = true
					for (const row of store.workspace_plans) {
						row.credited_months = (Number(row.credited_months) || 0) + 5
					}
					return res
				}
			}
			return chain
		},
	}
}

/**
 * Forces a claimed_at-clearing ledger update (an apply claim RELEASE after a
 * provider failure) to fail via a thrown fake error, surfacing the release
 * logging path. Only release-shaped patches are affected — a settle update
 * carries `applied_at`, and the claim update stamps a non-null claimed_at.
 */
function releaseFailureDb(store: Store) {
	const base = fakeDb(store)
	return {
		from: (table: string) => {
			const chain = base.from(table)
			if (table === "referral_credit_ledger") {
				const orig = chain.update.bind(chain)
				chain.update = (patch: Row) => {
					if (patch.claimed_at === null && !("applied_at" in patch)) {
						return Object.assign(chain, {
							then<TF, TR>(onfulfilled?: ((v: { data: Row[] | Row | null; error: FakeError | null }) => TF | PromiseLike<TF>) | null, onrejected?: ((r: unknown) => TR) | null) {
								return Promise.resolve({ data: null, error: { code: "release-x", message: "forced release failure" } }).then(onfulfilled, onrejected)
							},
						}) as unknown as typeof chain
					}
					return orig(patch)
				}
			}
			return chain
		},
	}
}

beforeEach(() => {
	for (const key of ENV_KEYS) saved[key] = process.env[key]
	delete process.env.BILLING_REFERRAL_BANK_CAP_MONTHS
	delete process.env.STRIPE_SECRET_KEY
	process.env.STRIPE_PRICE_PRO_MONTHLY_GA_USD = "price_pro_monthly_ga"
	process.env.STRIPE_PRICE_PLUS_MONTHLY_GA_USD = "price_plus_monthly_ga"
	process.env.STRIPE_PRICE_TEAM_MONTHLY_GA_USD = "price_team_monthly_ga"
	process.env.STRIPE_PRICE_PRO_MONTHLY_FOUNDING_USD = "price_pro_monthly_founding"
	process.env.STRIPE_PRICE_PRO_ANNUAL_FOUNDING_USD = "price_pro_annual_founding"
	process.env.STRIPE_PRICE_PRO_ANNUAL_GA_USD = "price_pro_annual_ga"
})

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key]
		else process.env[key] = saved[key]
	}
	vi.resetModules()
})

// ---------------------------------------------------------------------------
// grantConversionIfReferred — US-10 AC2 (conversion banks a 2nd month)
// ---------------------------------------------------------------------------

describe("grantConversionIfReferred", () => {
	it("banks one conversion month when the invited user converts paid (US-10 AC2)", async () => {
		const { grantConversionIfReferred } = await importService()
		// activation row already banked by the T3 trigger; counter 1.
		const store = seedStore({
			ledger: [ledgerRow()],
			plan: { credited_months: 1 },
		})

		const result = await grantConversionIfReferred(fakeDb(store) as never, WS_A)

		expect(result).toMatchObject({ granted: true, reason: "granted", months: 1, deferred: false })
		const rows = store.referral_credit_ledger.filter((r) => r.invitee_ref === INVITEE_A)
		expect(rows.map((r) => r.trigger_stage).sort()).toEqual(["activation", "conversion"])
		expect(rows.find((r) => r.trigger_stage === "conversion")).toMatchObject({
			workspace_id: WS_REFERRER,
			referrer_user_id: REFERRER,
			source_ref: REFERRER,
			invitee_user_id: INVITEE_A,
			months: 1,
			applied_at: null,
		})
		// counter bumped exactly once by the guarded insert
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	it("per-stage dedup honored: a repeat conversion grant for the same invitee never double-banks", async () => {
		const { grantConversionIfReferred } = await importService()
		const store = seedStore()
		const db = fakeDb(store)

		const first = await grantConversionIfReferred(db as never, WS_A)
		// replayed conversion event (second + third calls simulate re-delivery)
		const second = await grantConversionIfReferred(db as never, WS_A)
		const third = await grantConversionIfReferred(db as never, WS_A)

		expect(first.granted).toBe(true)
		expect(second).toMatchObject({ granted: false, reason: "duplicate" })
		expect(third).toMatchObject({ granted: false, reason: "duplicate" })
		expect(store.referral_credit_ledger.filter((r) => r.trigger_stage === "conversion")).toHaveLength(1)
		expect(store.workspace_plans[0].credited_months).toBe(1)
	})

	it("not-referred: an invitee without an attribution row grants nothing", async () => {
		const { grantConversionIfReferred } = await importService()
		const store = seedStore({ attribution: [] })

		const result = await grantConversionIfReferred(fakeDb(store) as never, WS_A)
		expect(result).toMatchObject({ granted: false, reason: "not-referred" })
		expect(store.referral_credit_ledger).toHaveLength(0)
	})

	it("self-referral blocked at attribution match-time: same user id and same email", async () => {
		const { grantConversionIfReferred } = await importService()

		// referrer referred themselves (ref === own user id)
		const idStore = seedStore({
			attribution: [{ user_id: REFERRER, ref: REFERRER, email_hash: md5Lower(REFERRER_EMAIL) }],
		})
		const idResult = await grantConversionIfReferred(fakeDb(idStore) as never, WS_REFERRER)
		expect(idResult).toMatchObject({ granted: false, reason: "self-referral" })
		expect(idStore.referral_credit_ledger).toHaveLength(0)

		// different account, SAME email as the referrer → blocked (farming vector)
		const emailStore = seedStore()
		const emailResult = await grantConversionIfReferred(fakeDb(emailStore) as never, WS_C)
		expect(emailResult).toMatchObject({ granted: false, reason: "same-email" })
		expect(emailStore.referral_credit_ledger).toHaveLength(0)
		expect(emailStore.workspace_plans[0].credited_months).toBe(0)
	})

	it("campaign refs and unknown referrers resolve to no grant", async () => {
		const { grantConversionIfReferred } = await importService()

		const campaignStore = seedStore({
			attribution: [{ user_id: INVITEE_A, ref: "instagram", email_hash: md5Lower("a@example.com") }],
		})
		const campaign = await grantConversionIfReferred(fakeDb(campaignStore) as never, WS_A)
		expect(campaign).toMatchObject({ granted: false, reason: "invalid-ref" })

		const ghostStore = seedStore({
			attribution: [{ user_id: INVITEE_A, ref: "99999999-9999-4999-8999-999999999999", email_hash: md5Lower("a@example.com") }],
		})
		const ghost = await grantConversionIfReferred(fakeDb(ghostStore) as never, WS_A)
		expect(ghost).toMatchObject({ granted: false, reason: "unknown-referrer" })
		expect(ghostStore.referral_credit_ledger).toHaveLength(0)
	})

	// -----------------------------------------------------------------------
	// Bank cap (BILLING_REFERRAL_BANK_CAP_MONTHS, default 12) — spec §8.5 / §16 D10
	// -----------------------------------------------------------------------

	it("bank cap blocks a grant that would take the bank beyond 12 months", async () => {
		const { grantConversionIfReferred, referralBankCapMonths } = await importService()
		expect(referralBankCapMonths()).toBe(12)

		// 11 outstanding months banked → this conversion is month #12: allowed.
		const eleven = Array.from({ length: 11 }, (_, i) =>
			ledgerRow({ invitee_ref: `invitee-${i}`, invitee_user_id: `invitee-${i}` }),
		)
		const okStore = seedStore({
			ledger: eleven,
			plan: {
				tier: "pro", billing_cycle: "monthly", gateway: "stripe",
				gateway_customer_id: "cus_1", gateway_subscription_id: "sub_1", currency: "USD",
				status: "active", credited_months: 11,
			},
		})
		const allowed = await grantConversionIfReferred(fakeDb(okStore) as never, WS_A)
		expect(allowed).toMatchObject({ granted: true })
		expect(okStore.workspace_plans[0].credited_months).toBe(12)

		// 12 outstanding → the 13th is capped: no row, no bump.
		const cappedStore = seedStore({
			ledger: [...eleven, ledgerRow({ invitee_ref: "invitee-11", invitee_user_id: "invitee-11" })],
			plan: {
				tier: "pro", billing_cycle: "monthly", gateway: "stripe",
				gateway_customer_id: "cus_1", gateway_subscription_id: "sub_1", currency: "USD",
				status: "active", credited_months: 12,
			},
		})
		const blocked = await grantConversionIfReferred(fakeDb(cappedStore) as never, WS_A)
		expect(blocked).toMatchObject({ granted: false, reason: "bank-cap" })
		expect(cappedStore.referral_credit_ledger.filter((r) => r.invitee_ref === INVITEE_A)).toHaveLength(0)
		expect(cappedStore.workspace_plans[0].credited_months).toBe(12)
	})

	it("bank cap is config, not a hardcode (spec §8.5)", async () => {
		process.env.BILLING_REFERRAL_BANK_CAP_MONTHS = "1"
		const { grantConversionIfReferred, referralBankCapMonths } = await importService()
		expect(referralBankCapMonths()).toBe(1)

		const store = seedStore({
			ledger: [ledgerRow()], // 1 month already outstanding at cap=1
			plan: { credited_months: 1 },
		})
		const result = await grantConversionIfReferred(fakeDb(store) as never, WS_A)
		expect(result).toMatchObject({ granted: false, reason: "bank-cap" })
		expect(store.referral_credit_ledger).toHaveLength(1) // no new row

		// invalid config falls back to the documented default, never a crash
		process.env.BILLING_REFERRAL_BANK_CAP_MONTHS = "not-a-number"
		expect(referralBankCapMonths()).toBe(12)
	})

	it("counts deferred (pre-workspace) banked months against the cap", async () => {
		process.env.BILLING_REFERRAL_BANK_CAP_MONTHS = "2"
		const { grantConversionIfReferred } = await importService()
		const store = seedStore({
			withReferrerWorkspace: false,
			ledger: [
				ledgerRow({ workspace_id: null, invitee_ref: "invitee-x", invitee_user_id: "invitee-x" }),
				ledgerRow({ workspace_id: null, invitee_ref: "invitee-y", invitee_user_id: "invitee-y", trigger_stage: "conversion" }),
			],
		})

		const result = await grantConversionIfReferred(fakeDb(store) as never, WS_A)
		expect(result).toMatchObject({ granted: false, reason: "bank-cap" })
	})

	// -----------------------------------------------------------------------
	// PDEC-4 deferred conversion grants — referrer workspace materializes later
	// -----------------------------------------------------------------------

	it("deferred conversion grant banks on the referrer's ledger key while their workspace is missing, then resolves + bumps exactly once", async () => {
		const { grantConversionIfReferred } = await importService()

		// Referrer has no workspace yet (lazy creation): the grant defers.
		const store = seedStore({ withReferrerWorkspace: false })
		const deferred = await grantConversionIfReferred(fakeDb(store) as never, WS_A)
		expect(deferred).toMatchObject({ granted: true, deferred: true })
		expect(store.referral_credit_ledger[0]).toMatchObject({
			workspace_id: null,
			referrer_user_id: REFERRER,
			invitee_ref: INVITEE_A,
			trigger_stage: "conversion",
		})

		// Referrer's workspace + billing root materialize later. A second referred
		// invitee converts; the service attaches the deferred row and bumps by the
		// promoted months + the new grant — exactly once each.
		store.workspaces.push({ id: WS_REFERRER, owner_id: REFERRER })
		store.workspace_plans.push({ ...REFERRER_PLAN_BASE })

		const second = await grantConversionIfReferred(fakeDb(store) as never, WS_B)
		expect(second).toMatchObject({ granted: true, deferred: false })

		const rows = store.referral_credit_ledger
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.workspace_id === WS_REFERRER)).toBe(true)
		// 1 (promoted deferred conversion for A) + 1 (new conversion for B)
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	// -----------------------------------------------------------------------
	// credited_months CAS discipline (PDEC-4 reconciliation) — the trigger and
	// this service are concurrent writers; a lost CAS never clobbers their bump
	// -----------------------------------------------------------------------

	it("creates the billing root when it is missing (positive delta), mirroring the trigger's insert pattern", async () => {
		const { grantConversionIfReferred } = await importService()
		// workspace exists but the workspace_plans root row does not (edge: a
		// pre-migration workspace that predates the backfill)
		const store = seedStore({ withPlan: false })

		const result = await grantConversionIfReferred(fakeDb(store) as never, WS_A)

		expect(result).toMatchObject({ granted: true })
		expect(store.workspace_plans).toHaveLength(1)
		expect(store.workspace_plans[0]).toMatchObject({ workspace_id: WS_REFERRER, credited_months: 1 })
	})

	it("a negative delta on a missing billing root is a no-op (never creates a row below zero)", async () => {
		const { applyCreditsAtRenewal } = await importService()
		// withPlan: false — workspace exists but the workspace_plans root row does not
		const store = seedStore({ withPlan: false, ledger: [] })
		expect(store.workspace_plans).toHaveLength(0)

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: creditStub().client as never })
		// no plan row ⇒ skip before any decrement
		expect(result).toMatchObject({ applied: false, reason: "no-plan-row", monthsApplied: 0 })
		expect(store.workspace_plans).toHaveLength(0)
	})

	it("credited_months CAS survives a concurrent trigger bump between read and write (re-reads, retries, never clobbers)", async () => {
		const { grantConversionIfReferred } = await importService()
		// counter starts at 0; the simulated trigger bump lands +5 between the
		// service's read and its guarded update, so the first CAS attempt misses
		const store = seedStore({ plan: { credited_months: 0 }, ledger: [] })

		const result = await grantConversionIfReferred(triggerBumpDb(store) as never, WS_A)

		expect(result).toMatchObject({ granted: true, months: 1 })
		// 5 (concurrent trigger bump, preserved) + 1 (this conversion grant)
		expect(store.workspace_plans[0].credited_months).toBe(6)
	})

	it("CAS retries exhausted logs drift loudly and still keeps the ledger insert (counter stays belt, ledger stays truth)", async () => {
		const { grantConversionIfReferred } = await importService()
		const store = seedStore({ plan: { credited_months: 0 }, ledger: [] })
		const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {})

		const result = await grantConversionIfReferred(triggerBumpDb(store, true) as never, WS_A)

		expect(result).toMatchObject({ granted: true })
		expect(consoleErr).toHaveBeenCalledWith("[billing] credited_months CAS retries exhausted", {
			workspaceId: WS_REFERRER,
			delta: 1,
		})
		consoleErr.mockRestore()
		// the conversion row LANDED (ledger truth) even though every counter CAS lost
		expect(store.referral_credit_ledger.filter((r) => r.trigger_stage === "conversion")).toHaveLength(1)
		// 4 concurrent trigger bumps preserved; the exhausted CAS wrote nothing
		expect(store.workspace_plans[0].credited_months).toBe(20)
	})
})

// ---------------------------------------------------------------------------
// applyCreditsAtRenewal — US-11 AC1/AC2, PDEC-2, PDEC-3
// ---------------------------------------------------------------------------

function stripePlan(over: Partial<Row> = {}): Row {
	return {
		tier: "pro",
		billing_cycle: "monthly",
		gateway: "stripe",
		gateway_customer_id: "cus_stripe_1",
		gateway_subscription_id: "sub_stripe_1",
		currency: "USD",
		is_founding: false,
		seats: null,
		status: "active",
		credited_months: 2,
		cancel_at_period_end: false,
		...over,
	}
}

describe("applyCreditsAtRenewal (Stripe)", () => {
	it("credits the T2-resolved price for the banked months on the provider, once", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan(),
			ledger: [
				ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" }),
				ledgerRow({ invitee_ref: INVITEE_A, trigger_stage: "conversion" }),
			],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })

		expect(result).toMatchObject({
			applied: true,
			reason: "applied",
			monthsApplied: 2,
			creditMinorUnits: 2400, // 2 × pro monthly GA $12.00 (1200 cents)
			balanceTransactionId: "bt_credit_1",
		})
		// PDEC-3: POST /v1/customers/{id}/balance_transactions with a NEGATIVE (credit) amount
		expect(create).toHaveBeenCalledTimes(1)
		const [customerId, params, options] = create.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
		expect(customerId).toBe("cus_stripe_1")
		expect(params).toMatchObject({ amount: -2400, currency: "usd" })
		expect(typeof options.idempotencyKey).toBe("string")
		expect(String(options.idempotencyKey)).toContain(WS_REFERRER)
		// ledger truth + counter (claimed_at cleared on settle — the claim stamp was
		// only ever in-flight state; applied_at is the settled truth)
		expect(store.referral_credit_ledger.every((r) => r.applied_at !== null)).toBe(true)
		expect(store.referral_credit_ledger.every((r) => r.claimed_at === null)).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(0)
	})

	it("Stripe apply idempotency: double invoice.paid ⇒ a single decrement and a single credit", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan(),
			ledger: [
				ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" }),
				ledgerRow({ invitee_ref: INVITEE_A, trigger_stage: "conversion" }),
			],
		})
		const { client, create } = creditStub()
		const db = fakeDb(store)

		const first = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		// same renewal processed twice (missed short-circuit at the gateway_events seam)
		const second = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })

		expect(first.applied).toBe(true)
		expect(second).toMatchObject({ applied: false, reason: "nothing-banked", monthsApplied: 0 })
		expect(create).toHaveBeenCalledTimes(1)
		expect(store.workspace_plans[0].credited_months).toBe(0)
	})

	it("re-applies only the months banked after the first apply (each renewal cycle counts once)", async () => {
		const { applyCreditsAtRenewal, grantConversionIfReferred } = await importService()
		const store = seedStore({
			plan: stripePlan({ credited_months: 1 }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()
		const db = fakeDb(store)

		const first = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		expect(first.monthsApplied).toBe(1)

		// a new referral conversion lands between renewal cycles
		const grant = await grantConversionIfReferred(db as never, WS_A)
		expect(grant.granted).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(1)

		const second = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		expect(second).toMatchObject({ applied: true, monthsApplied: 1, creditMinorUnits: 1200 })
		expect(create).toHaveBeenCalledTimes(2)
		expect(store.workspace_plans[0].credited_months).toBe(0)
	})

	it("provider failure releases the claim so the next renewal retries with the same idempotency key", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan(),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const failing = vi.fn(async () => {
			throw Object.assign(new Error("stripe unavailable"), { type: "StripeAPIError" })
		})
		const client = { customers: { createBalanceTransaction: failing } }
		const db = fakeDb(store)

		const failed = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		expect(failed).toMatchObject({ applied: false, reason: "provider-error", monthsApplied: 0 })
		// credit never marked applied or claimed, counter untouched
		expect(store.referral_credit_ledger[0].applied_at).toBeNull()
		expect(store.referral_credit_ledger[0].claimed_at).toBeNull()
		expect(store.workspace_plans[0].credited_months).toBe(2)

		const okStub = creditStub()
		const retry = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: okStub.client as never })
		expect(retry.applied).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(1)

		// the retry re-claims the SAME row set ⇒ SAME idempotency key (Stripe dedups
		// a failed-but-committed provider call); amount reflects one month of pro GA.
		const [, , failingOpts] = failing.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
		const [, okParams, okOpts] = okStub.create.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
		expect(okParams.amount).toBe(-1200)
		expect(String(okOpts.idempotencyKey)).toBe(String(failingOpts.idempotencyKey))
	})

	it("team credits multiply the per-seat price by the workspace seats", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan({ tier: "team", seats: 3, credited_months: 1 }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
		expect(result).toMatchObject({ applied: true, monthsApplied: 1, creditMinorUnits: 3000 }) // 1 × (3 × $10 GA)
		const [, params] = create.mock.calls[0] as unknown as [string, Record<string, unknown>]
		expect(params.amount).toBe(-3000)
	})

	it("annual plans credit at the same-cohort MONTHLY tier value (US-11 AC1, 1 banked month = 1 month)", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan({ is_founding: true, billing_cycle: "annual", credited_months: 1 }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
		// $80/yr catalog amount normalized to the founding MONTHLY value ($8) —
		// never the whole annual figure per banked month.
		expect(result.creditMinorUnits).toBe(800)
		const [, params] = create.mock.calls[0] as unknown as [string, Record<string, unknown>]
		expect(params.amount).toBe(-800)
	})

	it("annual credits scale linearly in months, not in years (2 months on GA annual)", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan({ billing_cycle: "annual", credited_months: 2 }),
			ledger: [
				ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" }),
				ledgerRow({ invitee_ref: "invitee-2", invitee_user_id: "invitee-2" }),
			],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
		// 2 × pro GA monthly $12 — not 2 × $120.
		expect(result).toMatchObject({ applied: true, monthsApplied: 2, creditMinorUnits: 2400 })
		const [, params] = create.mock.calls[0] as unknown as [string, Record<string, unknown>]
		expect(params.amount).toBe(-2400)
		expect(store.workspace_plans[0].credited_months).toBe(0)
	})

	it("missing customer reference keeps the banked credit intact and applies nothing", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan({ gateway_customer_id: null }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
		expect(result).toMatchObject({ applied: false, reason: "no-customer-id", monthsApplied: 0 })
		expect(create).not.toHaveBeenCalled()
		expect(store.referral_credit_ledger[0].applied_at).toBeNull()
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	// -----------------------------------------------------------------------
	// Claim semantics (claimed_at) — crash recovery + concurrency guard
	// -----------------------------------------------------------------------

	it("stale claims from a crashed apply are recovered: released, re-claimed, settled exactly once", async () => {
		const { applyCreditsAtRenewal } = await importService()
		// a worker died after stamping claimed_at, before the provider call
		const stranded = new Date(Date.now() - 20 * 60 * 1000).toISOString() // > 10min TTL
		const store = seedStore({
			plan: stripePlan(),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1", claimed_at: stranded })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })

		// the stale claim released => the row was re-claimable, credited, settled
		expect(result).toMatchObject({ applied: true, monthsApplied: 1, creditMinorUnits: 1200 })
		expect(create).toHaveBeenCalledTimes(1)
		expect(store.referral_credit_ledger[0]).toMatchObject({ applied_at: expect.any(String), claimed_at: null })
		expect(store.workspace_plans[0].credited_months).toBe(1) // single decrement after recovery
	})

	it("a FRESH claim from a live concurrent apply is never stolen", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const fresh = new Date(Date.now() - 5 * 1000).toISOString() // in-flight (< TTL)
		const store = seedStore({
			plan: stripePlan(),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1", claimed_at: fresh })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })

		expect(result).toMatchObject({ applied: false, reason: "nothing-banked", monthsApplied: 0 })
		expect(create).not.toHaveBeenCalled()
		// the live claim survives untouched
		expect(store.referral_credit_ledger[0]).toMatchObject({ claimed_at: fresh, applied_at: null })
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	it("logs (and never credits twice) when releasing the claim after a provider failure itself fails", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan(),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const failing = vi.fn(async () => {
			throw new Error("stripe unavailable")
		})
		const client = { customers: { createBalanceTransaction: failing } }
		const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {})

		const result = await applyCreditsAtRenewal(releaseFailureDb(store) as never, WS_REFERRER, { stripe: client as never })

		expect(result).toMatchObject({ applied: false, reason: "provider-error", monthsApplied: 0 })
		// release failed loudly, but rows stay claimed STALE (never settled) — the TTL
		// recovery path releases them on the next renewal; no double credit is possible
		expect(consoleErr).toHaveBeenCalledWith("[billing] failed to release referral credit claim", { workspaceId: WS_REFERRER, releaseErr: expect.anything() })
		expect(store.referral_credit_ledger[0].applied_at).toBeNull()
		expect(store.referral_credit_ledger[0].claimed_at).toBeTruthy() // never settled: the stale claim remains for TTL recovery
		store.referral_credit_ledger[0].claimed_at = new Date(Date.now() - 60 * 60 * 1000).toISOString() // age past the TTL
		consoleErr.mockRestore()

		// the stale claim recovers on the next renewal: credited exactly once
		const okDb = fakeDb(store)
		const retry = creditStub()
		const second = await applyCreditsAtRenewal(okDb as never, WS_REFERRER, { stripe: retry.client as never })
		expect(second).toMatchObject({ applied: true, monthsApplied: 1 })
		// same row set ⇒ same idempotency key ⇒ Stripe replays the same credit
		const [, , failingOpts] = failing.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
		const [, , okOpts] = retry.create.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>]
		expect(String(okOpts.idempotencyKey)).toBe(String(failingOpts.idempotencyKey))
		expect(store.workspace_plans[0].credited_months).toBe(1)
	})

	// -----------------------------------------------------------------------
	// Razorpay = bank-only, NEVER attempt redemption (PDEC-2)
	// -----------------------------------------------------------------------

	it("Razorpay workspaces bank conversion months but apply NEVER attempts a redemption", async () => {
		const { applyCreditsAtRenewal, grantConversionIfReferred } = await importService()
		const store = seedStore({
			plan: stripePlan({
				tier: "plus", gateway: "razorpay", gateway_customer_id: "cus_rp_1",
				gateway_subscription_id: "sub_rp_1", currency: "INR", is_founding: true, credited_months: 1,
			}),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()
		const db = fakeDb(store)

		// bank: the converted invitee sits on the Razorpay rail — the grant still lands
		const grant = await grantConversionIfReferred(db as never, WS_A)
		expect(grant).toMatchObject({ granted: true })
		expect(store.workspace_plans[0].credited_months).toBe(2)

		// apply: INR is bank-only — zero provider calls, ledger stays unapplied,
		// counter untouched (redemption rides the GA pricing decision, PDEC-2)
		const result = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		expect(result).toMatchObject({ applied: false, reason: "not-stripe-rail", monthsApplied: 0 })
		expect(create).not.toHaveBeenCalled()
		expect(store.referral_credit_ledger.every((r) => r.applied_at === null)).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	it("a corrupted stripe row (gateway=stripe, currency=INR) fails closed — no provider credit (review cycle 1, LOW 1)", async () => {
		const { applyCreditsAtRenewal } = await importService()
		const store = seedStore({
			plan: stripePlan({ currency: "INR" }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const { client, create } = creditStub()

		const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
		expect(result).toMatchObject({ applied: false, reason: "not-stripe-rail", monthsApplied: 0 })
		expect(create).not.toHaveBeenCalled()
		expect(store.referral_credit_ledger.every((r) => r.applied_at === null && r.claimed_at === null)).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(2)
	})

	// -----------------------------------------------------------------------
	// US-11 AC2 — credits unaffected by plan changes
	// -----------------------------------------------------------------------

	it("US-11 AC2: plan changes keep the banked months; apply uses the current tier's value", async () => {
		const { applyCreditsAtRenewal, getReferralSummary, grantConversionIfReferred } = await importService()
		const store = seedStore({
			plan: stripePlan({ tier: "pro", credited_months: 1 }),
			ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
		})
		const db = fakeDb(store)

		// the referrer downgrades pro → plus mid-cycle (same subscription mutated)
		store.workspace_plans[0].tier = "plus"

		// banked state unaffected by the plan change
		const before = await getReferralSummary(db as never, WS_REFERRER)
		expect(before.bankedMonths).toBe(1)
		expect(before.creditedMonths).toBe(1)

		// and new grants still land on the changed plan
		const grant = await grantConversionIfReferred(db as never, WS_A)
		expect(grant.granted).toBe(true)
		expect(store.workspace_plans[0].credited_months).toBe(2)

		// applied at the CURRENT tier value (US-11 AC2 value-equivalence note):
		// 2 × plus monthly GA $6.00 = 1200 cents
		const { client, create } = creditStub()
		const result = await applyCreditsAtRenewal(db as never, WS_REFERRER, { stripe: client as never })
		expect(result).toMatchObject({ applied: true, monthsApplied: 2, creditMinorUnits: 1200 })
		const [, params] = create.mock.calls[0] as unknown as [string, Record<string, unknown>]
		expect(params.amount).toBe(-1200)
	})

	it("downgrade to free / canceled subscription keeps the credit banked (apply skips, never redeems locally)", async () => {
		const { applyCreditsAtRenewal } = await importService()

		for (const plan of [
			stripePlan({ tier: "free", billing_cycle: "none", status: "canceled" }),
			stripePlan({ status: "canceled" }),
			stripePlan({ status: "incomplete" }),
		]) {
			const store = seedStore({
				plan,
				ledger: [ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" })],
			})
			const { client, create } = creditStub()

			const result = await applyCreditsAtRenewal(fakeDb(store) as never, WS_REFERRER, { stripe: client as never })
			expect(result).toMatchObject({ applied: false, reason: "no-active-subscription" })
			expect(create).not.toHaveBeenCalled()
			expect(store.referral_credit_ledger[0].applied_at).toBeNull()
			expect(store.workspace_plans[0].credited_months).toBe(2)
		}
	})
})

// ---------------------------------------------------------------------------
// getReferralSummary — T12(b) UI feed
// ---------------------------------------------------------------------------

describe("getReferralSummary", () => {
	it("summarizes banked/applied months per stage without leaking invitee identity", async () => {
		const { getReferralSummary, grantConversionIfReferred } = await importService()
		const store = seedStore({
			plan: stripePlan({ credited_months: 2 }),
			ledger: [
				ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1", applied_at: new Date(1_760_100_000_000).toISOString() }),
				ledgerRow({ invitee_ref: "invitee-2", invitee_user_id: "invitee-2" }),
				ledgerRow({ invitee_ref: INVITEE_A, trigger_stage: "conversion" }),
			],
		})

		// one more banked via the service itself
		await grantConversionIfReferred(fakeDb(store) as never, WS_B)

		const summary = await getReferralSummary(fakeDb(store) as never, WS_REFERRER)

		// counter: 2 seeded banked + 1 conversion-grant bump = 3
		expect(summary).toMatchObject({ workspaceId: WS_REFERRER, creditedMonths: 3, bankCapMonths: 12 })
		// ledger math: 2 seeded unapplied + 1 new = 3 banked; 1 applied; 4 lifetime
		expect(summary.bankedMonths).toBe(3)
		expect(summary.appliedMonths).toBe(1)
		expect(summary.lifetimeGrantedMonths).toBe(4)
		expect(summary.activationGrants).toBe(2)
		expect(summary.conversionGrants).toBe(2)
		expect(summary.capReached).toBe(false)
		expect(summary.rows).toHaveLength(4)
		expect(summary.rows[0].appliedAt).toBeNull() // newest first
		// PII-minimized: no invitee identifiers anywhere in the UI payload
		expect(JSON.stringify(summary)).not.toContain(INVITEE_A)
		expect(JSON.stringify(summary)).not.toContain("invitee")
	})

	it("reports capReached when the banked balance is at the configured cap", async () => {
		process.env.BILLING_REFERRAL_BANK_CAP_MONTHS = "2"
		const { getReferralSummary } = await importService()
		const store = seedStore({
			plan: { credited_months: 2 },
			ledger: [
				ledgerRow({ invitee_ref: "invitee-1", invitee_user_id: "invitee-1" }),
				ledgerRow({ invitee_ref: "invitee-2", invitee_user_id: "invitee-2" }),
			],
		})
		const summary = await getReferralSummary(fakeDb(store) as never, WS_REFERRER)
		expect(summary).toMatchObject({ bankedMonths: 2, bankCapMonths: 2, capReached: true })
	})
})
