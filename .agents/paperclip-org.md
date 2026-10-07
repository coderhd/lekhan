# Paperclip Organization — Silent Whisper / Lekhan

This is the live operating setup for the virtual org that builds Lekhan. It complements
`docs/agents/organization.md` (roles + SDLC) and `.agents/model-routing.md` (model policy);
where they disagree, the Paperclip company is the runtime truth.

## Company & project

- **Company:** Silent Whisper (`b044e7dc-7bb3-46b8-a47f-596a3c75d879`)
- **Project:** Lekhan (`9b5e4978-d493-455e-ae41-2885cff9dc8b`) — workspace `cwd = repo`, repo `coderhd/lekhan`
- **Goal:** "Ship Lekhan to public launch" (`2e752c8b-3f7b-4e94-8ea1-b1109491a425`)
- **Paperclip base URL:** `http://127.0.0.1:3100` (local_trusted)

## Roster & models

All agents are `opencode_local` (cwd = this repo). Timer heartbeats are **off**; agents wake on
assignment/mention (`wakeOnDemand`), which is the main spend control.

| Agent | Role | Model | Why |
|---|---|---|---|
| OpenCode Agent | `ceo` | `opencode-go/qwen3.8-flash` | highest wake rate → large budget |
| Product Owner | `pm` | `opencode-go/glm-5.3-flash` | spec/PRD judgment, moderate volume |
| Tech Lead | `cto` | `opencode-go/qwen3.8-flash` | architecture/review, heavy |
| QA Engineer | `qa` | `opencode-go/qwen3.8-flash` | high-volume tests + adversarial review |
| Dev Engineer | `engineer` | `opencode-go/deepseek-v4.1-flash` | highest volume |
| DevOps Engineer | `devops` | `opencode-go/deepseek-v4.1-flash` | moderate volume |
| Growth Lead | `cmo` | `opencode-go/glm-5.3-flash` | occasional |

**Frontier / Tier S = `opencode-go/mimo-v2.6-pro`** (replaces GLM-5.3, whose Go budget is only
1,080 req/mo). It is *not* a default for any agent — apply it per issue via
`assigneeAdapterOverrides.adapterConfig.model` for score 7–10 work and the clean-room review stage.
The dev-time router preset in `.opencode/opencode-model-router.overrides.jsonc` now maps
fast/medium/heavy → `deepseek-v4.1-flash` / `qwen3.8-flash` / `mimo-v2.6-pro`.

Budget reality — OpenCode Go **typical-usage estimates**, not fixed quotas (OpenCode labels these
estimates based on typical usage; verify against the current
[OpenCode Go table](https://dev.opencode.ai/docs/go/)): MiMo-V2.6-Pro **~16,300** ($15/mo cap) ·
GLM-5.3 **~1,080** · GLM-5.3-Flash **~31,580** · Qwen3.8 Flash **~27,000** · DeepSeek V4.1 Flash
**~37,800** req/month. MiMo is the frontier pick and its budget is large enough to use for the
review stage, not just rare escalations. Estimate: CEO ~4–6k, Tech Lead ~3–4.5k req/month. Never
route defaults to a Tier-S model.

## Skills

Company skills are the runtime source of truth for agent skills (94 total):
- **73** imported from `.agents/skills/` (local-path import).
- **14** superpowers process skills created from content (local import was blocked as outside
  approved workspace roots).
- **`lekhan-verification`** — the independent verification gate (writer ≠ verifier, fresh-context
  falsification, fail-closed, evidence over bundle).
- Paperclip bundled core (`paperclip`, `paperclip-board`, …).

Per-role bundles are assigned via `desiredSkills`. ⚠️ OpenCode currently materializes skills into
the **shared** `~/.claude/skills` home, so per-agent skill isolation is soft — a known Paperclip
integration limitation, not a config error.

## Task source: GitHub → Paperclip

GitHub remains the authoring source; Paperclip is the home. `scripts/paperclip/import-github-issues.mjs`
is a **one-way, idempotent** importer:

- Reads `gh issue list` (open issues), creates Paperclip issues with a durable marker
  `source:github/coderhd/lekhan#<n>` so re-runs reconcile instead of duplicating.
- Maps labels (creating them), epics/horizons → priority, and `Blocked by #n` → native blockers.
- Run: `node scripts/paperclip/import-github-issues.mjs [--dry-run]`.
- Config via env or `~/.paperclip-onboarding/paperclip.env`
  (`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_PROJECT_ID`).

First run imported **31** open issues (27 backlog, 4 todo) as `SIL-xx`. There is no status
sync-back to GitHub; if bidirectional sync is wanted, it must be built on top of this.

## Operating loop

Follow `AGENTS.md`'s 6-stage lifecycle (`/spec → /plan → /build → /test → /review → /ship`).
The `/review` gate uses the `lekhan-verification` invariants: a different agent/model family from
the author, fresh context, per-criterion falsification, fail-closed on anything unverifiable.

## Credentials (never commit)

The `~/.paperclip-onboarding/` directory uses mode `0700`; its credential files use mode `0600`:
`paperclip.env` (CEO) and `team-keys.json` (all agents). Do not paste keys into issues, comments,
docs, or logs.
