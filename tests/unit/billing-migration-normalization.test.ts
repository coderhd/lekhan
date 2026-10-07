import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

import { normalizeLegacyPlan } from "@/lib/billing/legacy-plan-normalization"

/**
 * T3 migration pins (plan T3; spec §4; PDEC-4/5; TL round-2 B3 + note 5).
 *
 * The SQL function `normalize_legacy_plan` is the SQL twin of `normalizeLegacyPlan`
 * (lib/billing/legacy-plan-normalization.ts, T2); the two must stay in lockstep. This
 * suite pins the SQL half against the TypeScript half over a canonical corpus, plus the
 * schema/trigger/RLS surface the migration must provide. The migration's in-file `DO $$`
 * smoke block re-asserts the normalization map at apply time on the database.
 */

const MIGRATION_PATH = resolve(
	process.cwd(),
	"supabase/migrations/20261007000000_billing_workspace_plans.sql",
)

const sql = readFileSync(MIGRATION_PATH, "utf8")

// Structural assertions run against comment-stripped SQL so that explanatory prose
// (e.g. "minus credit_overlay_months", "no waitlist objects") is not mistaken for DDL.
const sqlNoComments = sql
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/--[^\n]*/g, "")

// Canonical corpus, shared by both twins.
const NORMALIZATION_CASES: Array<string | null> = [
	"free",
	"plus",
	"pro",
	"team",
	"go",
	"Go ",
	"GO",
	"enterprise",
	" Enterprise ",
	"ENTERPRISE",
	"wat",
	"",
	null,
]

function extractSqlNormalizationMap(): Map<string, string> {
	const fnStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.normalize_legacy_plan")
	expect(fnStart, "normalize_legacy_plan definition present").toBeGreaterThan(-1)
	const fnBody = sql.slice(fnStart, sql.indexOf("$$;", fnStart))
	const map = new Map<string, string>()
	const re = /WHEN\s+'([^']+)'\s+THEN\s+'([^']+)'/g
	let match: RegExpExecArray | null
	while ((match = re.exec(fnBody)) !== null) {
		map.set(match[1], match[2])
	}
	return map
}

function resolveSqlPlan(map: Map<string, string>, input: string | null): string {
	const key = (input ?? "").trim().toLowerCase()
	return map.get(key) ?? "free" // fallback arm
}

describe("billing migration — normalize_legacy_plan SQL twin", () => {
	const map = extractSqlNormalizationMap()

	it("encodes the go -> plus / enterprise -> free mapping", () => {
		expect(map.get("go")).toBe("plus")
		expect(map.get("enterprise")).toBe("free")
	})

	it("agrees with the TypeScript twin on every canonical case", () => {
		for (const input of NORMALIZATION_CASES) {
			const expected = normalizeLegacyPlan(input)
			expect(resolveSqlPlan(map, input), `legacy plan ${JSON.stringify(input)}`).toBe(expected)
		}
	})

	it("has an in-migration smoke block re-asserting the parity pins", () => {
		expect(sqlNoComments).toMatch(/DO \$\$/)
		expect(sqlNoComments).toMatch(/normalize_legacy_plan\('go'\)/)
		expect(sqlNoComments).toMatch(/normalize_legacy_plan\('enterprise'\)/)
		expect(sqlNoComments).toMatch(/normalize_legacy_plan\(NULL\)/)
	})
})

describe("billing migration — schema surface", () => {
	it("creates the five billing tables", () => {
		expect(sqlNoComments).toMatch(/CREATE TABLE IF NOT EXISTS public\.plan_tiers/)
		expect(sqlNoComments).toMatch(/CREATE TABLE IF NOT EXISTS public\.workspace_plans/)
		expect(sqlNoComments).toMatch(/CREATE TABLE IF NOT EXISTS public\.gateway_events/)
		expect(sqlNoComments).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_credit_ledger/)
		expect(sqlNoComments).toMatch(/CREATE TABLE IF NOT EXISTS public\.referral_attribution/)
	})

	it("workspace_plans carries the TL B3 state columns and drops credit_overlay_months", () => {
		for (const col of ["cancel_at_period_end", "past_due_since", "last_checked_at", "credited_months"]) {
			expect(sqlNoComments, `workspace_plans.${col}`).toMatch(new RegExp(`${col}\\s+`))
		}
		expect(sqlNoComments).not.toMatch(/credit_overlay_months/)
	})

	it("gateway_events dedups event_id", () => {
		expect(sqlNoComments).toMatch(/event_id TEXT NOT NULL UNIQUE/)
	})

	it("referral_credit_ledger grants once per invitee per stage, including the deferred partial index", () => {
		expect(sqlNoComments).toMatch(/UNIQUE \(workspace_id, invitee_ref, trigger_stage\)/)
		expect(sqlNoComments).toMatch(
			/CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_ledger_deferred_stage_key\s+ON public\.referral_credit_ledger \(invitee_ref, trigger_stage\)\s+WHERE workspace_id IS NULL/,
		)
		expect(sqlNoComments).toMatch(/trigger_stage TEXT NOT NULL CHECK \(trigger_stage IN \('activation', 'conversion'\)\)/)
	})

	it("enables RLS on every billing table and grants writes only to service_role", () => {
		for (const table of [
			"plan_tiers",
			"workspace_plans",
			"gateway_events",
			"referral_credit_ledger",
			"referral_attribution",
		]) {
			expect(sqlNoComments, `RLS ${table}`).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`))
			expect(sqlNoComments, `service_role ${table}`).toMatch(
				new RegExp("FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\)"),
			)
		}
	})

	it("installs the attribution companion trigger and the activation grant trigger", () => {
		expect(sqlNoComments).toMatch(/CREATE TRIGGER on_auth_user_created_referral_attribution/)
		expect(sqlNoComments).toMatch(/AFTER INSERT ON auth\.users/)
		expect(sqlNoComments).toMatch(/CREATE TRIGGER on_workspace_created_billing/)
		expect(sqlNoComments).toMatch(/AFTER INSERT ON public\.workspaces/)
		expect(sqlNoComments).toMatch(/SECURITY DEFINER/)
	})

	it("backfills one workspace_plans row per existing workspace, idempotently", () => {
		expect(sqlNoComments).toMatch(/INSERT INTO public\.workspace_plans \(workspace_id, tier, billing_cycle, gateway, status\)/)
		expect(sqlNoComments).toMatch(/public\.normalize_legacy_plan\(p\.plan\)/)
		expect(sqlNoComments).toMatch(/ON CONFLICT \(workspace_id\) DO NOTHING/)
	})

	it("references no waitlist objects (PDEC-6)", () => {
		expect(sqlNoComments).not.toMatch(/join_waitlist|brevo_outbox|public\.waitlist/i)
	})
})
