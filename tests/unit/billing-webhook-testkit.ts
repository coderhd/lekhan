/**
 * T8 test double kit — shared by the billing-webhooks-*.test.ts suites.
 *
 * Carries no expectations of its own (behavior specs stay per-suite, DAMP):
 *  - an in-memory Supabase PostgREST chain double covering exactly the surface
 *    `services/billing/webhook-processor.ts` uses (select/eq/is/insert/update/
 *    upsert/maybeSingle), with the `gateway_events.event_id` UNIQUE and the
 *    `workspace_plans` PK semantics emulated so idempotency is proven against
 *    real conflicts, not pre-checks;
 *  - fake provider read-back seams (the payload is audit-only; entitlement
 *    state is written from the read-back);
 *  - in-test signing helpers for both rails (documented schemes, test keys
 *    only — no secrets committed).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import type { SubscriptionReadBack } from "@/services/billing/webhook-processor"

// ---------------------------------------------------------------------------
// In-memory PostgREST double
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>
export type Store = Record<string, Row[]>

export interface FakeError {
	code: string
	message: string
}

type Op = { kind: "insert"; row: Row } | { kind: "update"; patch: Row } | { kind: "upsert"; patch: Row; onConflict: string | null } | { kind: "read" }

const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value) as string)

/** SQL defaults for a fresh workspace_plans row (T3 migration column defaults). */
export const WORKSPACE_PLANS_DEFAULTS: Row = {
	workspace_id: "",
	tier: "free",
	billing_cycle: "none",
	gateway: "none",
	gateway_customer_id: null,
	gateway_subscription_id: null,
	currency: null,
	is_founding: false,
	seats: null,
	status: "none",
	current_period_end: null,
	credited_months: 0,
	cancel_at_period_end: false,
	past_due_since: null,
	last_checked_at: null,
}

let autoId = 0
const nextId = () => `gen-${++autoId}`

class FakeChain implements PromiseLike<{ data: Row[] | Row | null; error: FakeError | null }> {
	private filters: Array<(row: Row) => boolean> = []
	private cols = "*"
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

	is(col: string, val: null): this {
		this.filters.push((row) => (row[col] ?? null) === val)
		return this
	}

	maybeSingle(): Promise<{ data: Row | null; error: FakeError | null }> {
		return this.exec().then((res) => ({
			data: res.error ? null : ((res.data as Row[])[0] ?? null),
			error: res.error,
		}))
	}

	private conflict(): FakeError | null {
		if (this.op.kind !== "insert") return null
		const row = this.op.row
		if (this.table === "gateway_events") {
			const dup = this.store["gateway_events"]?.some((r) => r.event_id === row.event_id)
			if (dup) return { code: "23505", message: "duplicate key value (gateway_events event_id)" }
		}
		if (this.table === "workspace_plans") {
			const dup = this.store["workspace_plans"]?.some((r) => r.workspace_id === row.workspace_id)
			if (dup) return { code: "23505", message: "duplicate key value (workspace_plans pk)" }
		}
		return null
	}

	private matched(): Row[] {
		return (this.store[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)))
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

	private exec(): Promise<{ data: Row[] | Row | null; error: FakeError | null }> {
		if (this.op.kind === "insert") {
			const err = this.conflict()
			if (err) return Promise.resolve({ data: null, error: err })
			const row: Row = { id: nextId(), created_at: new Date(0).toISOString(), ...(clone(this.op.row) as Row) }
			;(this.store[this.table] ??= []).push(row)
			return Promise.resolve({ data: this.project([row]), error: null })
		}
		if (this.op.kind === "update") {
			const targets = this.matched()
			for (const row of targets) Object.assign(row, clone(this.op.patch) as Row)
			return Promise.resolve({ data: this.project(targets), error: null })
		}
		if (this.op.kind === "upsert") {
			const op = this.op
			const key = op.onConflict
			if (key) {
				const existing = (this.store[this.table] ??= []).find((r) => r[key] === op.patch[key])
				if (existing) {
					Object.assign(existing, clone(op.patch) as Row)
					return Promise.resolve({ data: this.project([existing]), error: null })
				}
			}
			const row: Row = {
				...(this.table === "workspace_plans" ? (clone(WORKSPACE_PLANS_DEFAULTS) as Row) : {}),
				...(clone(op.patch) as Row),
			}
			;(this.store[this.table] ??= []).push(row)
			return Promise.resolve({ data: this.project([row]), error: null })
		}
		return Promise.resolve({ data: this.project(this.matched()), error: null })
	}

	then<TF = { data: Row[] | Row | null; error: FakeError | null }, TR = never>(
		onfulfilled?: ((value: { data: Row[] | Row | null; error: FakeError | null }) => TF | PromiseLike<TF>) | null,
		onrejected?: ((reason: unknown) => TR | PromiseLike<TF | TR>) | null,
	): PromiseLike<TF | TR> {
		return this.exec().then(onfulfilled, onrejected)
	}
}

export function fakeDb(store: Store): { from(table: string): FakeChain; store: Store } {
	return {
		from: (table: string) => new FakeChain(store, table),
		store,
	}
}

/** The processor takes a `SupabaseClient`; the double satisfies it structurally at runtime. */
export function asSupabaseClient(db: unknown): import("@supabase/supabase-js").SupabaseClient {
	return db as unknown as import("@supabase/supabase-js").SupabaseClient
}

// ---------------------------------------------------------------------------
// Seeded billing-root state
// ---------------------------------------------------------------------------

export const WS = "11111111-1111-4111-8111-111111111111"
export const OWNER = "22222222-2222-4222-8222-222222222222"
export const SUB = "sub_test_001"
export const CUSTOMER = "cus_test_001"

export function seedStore(overrides: { plan?: Row; profiles?: Row[] } = {}): Store {
	return {
		workspaces: [{ id: WS, owner_id: OWNER }],
		profiles: overrides.profiles ?? [{ id: OWNER, plan: "free" }],
		workspace_plans: [
			{
				...WORKSPACE_PLANS_DEFAULTS,
				workspace_id: WS,
				...(overrides.plan ? clone(overrides.plan) as Row : {}),
			},
		],
		gateway_events: [],
	}
}

// ---------------------------------------------------------------------------
// Fake provider read-back seams
// ---------------------------------------------------------------------------

export interface ReadBackOverrides {
	subscriptionRef?: string
	customerRef?: string | null
	workspaceId?: string | null
	status?: "active" | "past_due" | "canceled" | "incomplete"
	cancelAtPeriodEnd?: boolean
	currentPeriodEnd?: string | null
	tier?: "plus" | "pro" | "team" | null
	cycle?: "monthly" | "annual" | null
	isFounding?: boolean
	seats?: number | null
}

export function readBackReturning(overrides: ReadBackOverrides = {}) {
	return async (): Promise<SubscriptionReadBack> => ({
		subscriptionRef: SUB,
		customerRef: CUSTOMER,
		workspaceId: WS,
		status: "active",
		cancelAtPeriodEnd: false,
		currentPeriodEnd: "2026-02-01T00:00:00.000Z",
		tier: "plus",
		cycle: "monthly",
		isFounding: false,
		seats: 1,
		...overrides,
	})
}

/** Provider reports the pointed-at object gone (Stripe resource_missing / 404). */
export function readBackGone() {
	return async (): Promise<null> => null
}

export function readBackThrowing(err: Error) {
	return async (): Promise<never> => {
		throw err
	}
}

// ---------------------------------------------------------------------------
// In-test signature schemes (documented provider schemes; test keys only)
// ---------------------------------------------------------------------------

export const STRIPE_TEST_SECRET = "whsec_testkit_000000000000000000000000"
export const RAZORPAY_TEST_SECRET = "rzp_testkit_secret_000000000000"

/** Stripe scheme: `t=<unix>,v1=HMAC_SHA256(secret, "${t}.${payload}")`. */
export function stripeSignatureHeader(rawBody: string, secret = STRIPE_TEST_SECRET, atMs = Date.now()): string {
	const t = Math.floor(atMs / 1000)
	const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")
	return `t=${t},v1=${v1}`
}

/** Razorpay scheme: hex HMAC-SHA256 of the raw request body. */
export function razorpaySignature(rawBody: string, secret = RAZORPAY_TEST_SECRET): string {
	return createHmac("sha256", secret).update(rawBody).digest("hex")
}

export function contentEventId(rawBody: string): string {
	return `rzp_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`
}

/** Timing-safe compare mirror for the Razorpay rail (parity check in tests). */
export function signaturesEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a)
	const bb = Buffer.from(b)
	if (ba.length !== bb.length) return false
	return timingSafeEqual(ba, bb)
}
