# Execution Gates — Reviewers, Approvers, Monitor, Watchdog

Every active issue gets its execution gates assigned automatically, by a 1–10 complexity score.
The deterministic assigner is `scripts/paperclip/assign-execution-gates.mjs`, run by the
**Execution Gate Assignment** Paperclip routine every 4 hours (and usable by hand).

## Complexity score

Base 3, then add:

| Signal | Points |
|---|---|
| `est:5` label | +2 |
| `est:8` label | +4 |
| `epic` or `needs-spec` label | +3 |
| `h0` label | +2 |
| `h1` label | +1 |
| billing / payment / stripe / razorpay / auth / encryption / sync / crdt / migration / security (title or body) | +2 |
| ui / ux / design / frontend / page / component / layout / accessib / visual | +2 |

Bands: **low** 1–3 · **medium** 4–6 · **high** 7–10.

## Gates by band

| Band | Reviewers | Approvers | Monitor | Watchdog |
|---|---|---|---|---|
| **low** | Tech Lead | — | — | — |
| **medium** | Tech Lead + QA | — | re-check in 3d, `wake_owner` | Product Owner |
| **high** | Tech Lead + QA (+ UI/UX Designer for UI work) | CEO | re-check in 1d, `escalate_to_board` | CEO |

- **Reviewers / Approvers** → `executionPolicy.stages` (`review` / `approval` + agent participants).
- **Monitor** → `executionPolicy.monitor` (scheduled re-check; only allowed on issues that are
  assigned and `in_progress`/`in_review`).
- **Watchdog** → `PUT /api/issues/:id/watchdog` (`agentId` + instructions) — the stall guard.

## Behaviour

- **Idempotent:** issues that already have execution stages are skipped; safe to re-run.
- Flags: `--dry-run` (preview), `--all` (also include `in_review` / `blocked`).
- Default targets: `todo` and `in_progress` issues.

## Usage

```bash
node scripts/paperclip/assign-execution-gates.mjs --dry-run
node scripts/paperclip/assign-execution-gates.mjs
```

Config via env or `~/.paperclip-onboarding/paperclip.env`
(`PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`).
