/**
 * Legacy plan-token normalization (spec §4.4, plan T2).
 *
 * `profiles.plan` is free TEXT and historically carried `free|go|pro|team|enterprise`.
 * The H0 billing cutover only ever admits the canonical tiers below, so every legacy
 * token (including `go` and `enterprise`) is normalized before it can reach
 * `lib/tier-limits.ts` — whose unknown-plan fallback would otherwise silently serve
 * FREE_LIMITS to a paying workspace.
 *
 * This function is the TypeScript mirror of the `normalize_legacy_plan(text)` SQL
 * function added by T3's migration; the two must stay in lockstep (parity is asserted
 * by T3's `billing-migration-normalization.test.ts`).
 */

export type NormalizedPlan = "free" | "plus" | "pro" | "team"

/** `go` was the retired July INR tier; it maps to its closest entitlement peer. */
const PLUS_ALIASES = new Set(["plus", "go"])

export function normalizeLegacyPlan(plan?: string | null): NormalizedPlan {
	const token = (plan ?? "").trim().toLowerCase()

	if (PLUS_ALIASES.has(token)) return "plus"
	if (token === "pro") return "pro"
	if (token === "team") return "team"

	// `free` passes through; `enterprise` (out of H0 scope) and any unknown,
	// empty, or missing token fall back to `free`.
	return "free"
}
