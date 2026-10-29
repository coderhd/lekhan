---
name: model-routing
description: Decide which OpenCode Go model to use for a task, via a 1-10 complexity score mapped to S/A/B/C tiers. The opencode-model-router plugin preset (see .opencode/opencode-model-router.overrides.jsonc) is ADVISORY — it reports routing guidance but does not hard-block a different tier. This file is the human-readable reference the tiers/scoring are derived from.
---

# Model routing policy — OpenCode Go

**Advisory note (2026-08-31, corrected 2026-10-07):** this policy is wired into
the `opencode-model-router` plugin as **advisory guidance** — the committed preset
sets `enforcement.mode: "advisory"`, so the plugin reports routing guidance but
does **not** hard-block a different tier. See
`.opencode/opencode-model-router.overrides.jsonc` for the actual fast/medium/heavy
preset (B/A/S below map to its fast/medium/heavy). This file remains the
reference for *why* those tiers are what they are — read it when tuning the
override file, not as something an agent has to remember to consult per-task.

## Data sources (fetched 2026-08-29 — re-check both monthly, Go is Beta)
- Model list + official per-model request estimates: https://opencode.ai/docs/go/#usage-limits
- Intelligence scores: Artificial Analysis Intelligence Index v4.1.1, https://artificialanalysis.ai/leaderboards/models (0-63+ scale)
- Request counts are OpenCode's own estimates from their observed average tokens/request. Actual cost per request depends on your real token mix — track usage in the OpenCode console and recalibrate.

## Kept models (score >= 50, plus two explicit exceptions)

Discarded below 50: GLM-5.1, GPT 5.6 Luna, Kimi K2.7 Code, Kimi K2.6, LongCat-2.0,
MiMo-V2.5, MiMo-V2.5-Pro, MiniMax M3, MiniMax M2.7, Qwen3.7 Max, Qwen3.7 Plus,
Qwen3.6 Plus, Hy3.

| Model | AA Intelligence | Req/5h | Req/week | Req/month | Tier |
|---|---|---|---|---|---|
| MiMo-V2.6-Pro | frontier pick (owner, unbenchmarked) | 3,250 | 8,150 | 16,300 | S |
| GLM-5.3 | 60 | 220 | 540 | 1,080 | S |
| Kimi K3 | ~60 (48-60 by effort) | 110 | 250 | 490 | S |
| Grok 4.6 | 52-61 (effort-dependent) | 169 | 423 | 845 | S |
| Qwen3.8 Max | 58 | 160 | 400 | 810 | S |
| GLM-5.3-Flash | 57 | 1,580 | 3,950 | 7,900 | A |
| Qwen3.8 Flash | 56 | 5,400 | 13,500 | 27,000 | A |
| Muse Spark 1.2 Contributor | 57 (xhigh variant) | 45,300 | 113,300 | 226,600 | A* |
| GLM-5.2 | 53 | 880 | 2,150 | 4,300 | B |
| DeepSeek V4 Pro | 53 (confirmed: Aug 13 weight update, same version served on Go) | 1,050 | 2,600 | 5,200 | B |
| DeepSeek V4 Flash | 52 | 7,600 | 18,900 | 37,800 | B |
| DeepSeek V4 Flash Vision Exp | 51 | 3,800 | 9,450 | 18,900 | B |
| Hy4 preview | unbenchmarked (recent launch, kept deliberately) | 1,350 | 3,380 | 6,770 | C |

\* Muse Spark trains on your prompts/completions (Meta contributor-tier discount) and
is region-limited. Given Lekhan's own positioning is built on data ownership, use it
only with that tradeoff deliberately accepted — not as a default pick for the
throughput number alone. Not wired into the default override preset for this reason.

## Complexity score (1-10) -> tier

Score from three signals, not spec presence alone:
- **Spec clarity**: full spec / mirrors an existing pattern (low) -> partial ->
  none, agent must design it (high)
- **System criticality**: leaf feature (low) -> touches sync/CRDT/auth/encryption/
  billing, i.e. anything under ADR 0001/0003/0004 (high)
- **Reversibility**: easy revert (low) -> data migration / hard to undo (high)

| Score | Band | Tier |
|---|---|---|
| 1-3 | Spec'd or pattern-mirroring, leaf feature, low stakes | **B** |
| 4-6 | Spec'd-with-judgment, or unspec'd-but-narrow, moderate blast radius | **A** |
| 7-10 | No spec + must design it, or touches core/ADR-governed systems, or high-stakes/irreversible | **S** |

**Important refinement — spec-writing vs. spec-following are different jobs:**
a `needs-spec` epic going through its `to-spec` pass is genuinely Tier S (maximum
ambiguity, nothing to mirror). But once that spec exists, the tickets implementing
it usually drop to Tier A or B, because the ambiguity that justified Tier S has
already been resolved. Don't route every downstream ticket at Tier S just because
the epic originally lacked a spec — re-score once the spec exists. This matters
because Tier S budgets are the tightest on the roster (as low as 490/month for
Kimi K3) — spending them on already-de-risked implementation work is the fastest
way to exhaust the plan for no quality gain.

## Tier routing

**Tier S (score 7-10):** MiMo-V2.6-Pro (primary — the frontier pick, 16,300 req/mo, $15/mo cap;
~790 input / 86,000 cached / 305 output tokens per request) -> GLM-5.3 -> Qwen3.8 Max -> Kimi K3 (tightest
budget, use last) -> Grok 4.6. Use for: the spec-writing pass on a `needs-spec`
epic, anything touching sync/CRDT/auth/encryption, high-stakes or hard-to-revert
changes, genuinely novel problems with no existing pattern. Also: the REVIEW stage
clean-room subagent in AGENTS.md's 6-stage lifecycle (currently written as
`Model: 'pro'`) — worth updating that reference to point at this tier explicitly.

**Tier A (score 4-6):** Qwen3.8 Flash (higher throughput, default for volume) and
GLM-5.3-Flash (slight intelligence edge, use when that matters more than volume) —
alternate between them, both are strong. Muse Spark sits here too, opt-in only
(see caveat above), not in the automatic preset. Use for: implementing a spec'd
ticket that still needs some judgment, unspec'd but narrow/contained work.

**Tier B (score 1-3):** DeepSeek V4 Flash (default, highest throughput at this
tier) -> GLM-5.2 / DeepSeek V4 Pro -> DeepSeek V4 Flash Vision Exp (anything
involving images). Use for: spec'd or pattern-mirroring work, leaf features, low
blast radius.

**Tier C (Hy4 preview, unscored):** not a default destination for any complexity
band. Deliberately route a small volume of what-would-be-Tier-B tasks here to
generate real outcome data, then reclassify into the scored tiers once evidence
exists.

## Decision procedure (now automated — see enforcement note above)

1. Score complexity 1-10 using the three signals above.
2. If this is a spec-writing pass for a `needs-spec` epic, score it 7-10 (Tier S)
   regardless of the epic's eventual implementation complexity — then re-score the
   resulting tickets independently once the spec exists.
3. Check remaining budget in the current 5h window. If >70% spent, drop one tier
   below what the score alone suggests.
4. Route to the tier's primary model; fall through alternates if capped.
5. Log which model/tier/score handled the task, to review and rebalance weekly.

## Fallback chain

Tier model on Go -> same-family model on Zen balance (pay-per-token, needs its own
top-up) -> free base model (Tier B work only) -> escalate to human for anything
above Tier B if forced down to a free model.

## Recalibration

Re-pull both source tables monthly (Go's roster/pricing changes; Artificial
Analysis re-scores models). Once real usage data exists, correct tier assignments
and the Tier C classification against actual task outcomes, not just these
benchmarks.
