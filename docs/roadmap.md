# Lekhan Product Roadmap

> **Single source of truth: the GitHub issue tracker.** Every roadmap item below is an
> epic on the tracker; dependency edges are recorded as native GitHub blockers
> (`blocked_by`). This document mirrors those epics, adds the sequencing narrative,
> and keeps the full product picture survivable across sessions. If tracker state
> and this file disagree, the tracker wins — update this file to match.
>
> **Scheduling policy (2026-08-24, owner call):** the public beta is **quality-gated, not date-gated** — it opens when the first-ten-minutes path (signup → import → collaborate → export) passes the #79 UX-parity bar, and invites roll gradually from the /early waitlist. All dates below are directional planning aids, not commitments. "Free" is a permanent positioning pillar: the free tier survives billing (#29).
>
> **Strategy:** `docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md`
> (approved, §4 horizons; §11 future specs). Labels: `epic` + horizon (`h0`/`h1`/`h2`/`h3`);
> `needs-spec` marks epics without a written spec yet; `done` marks delivered epics.

## Status vocabulary

| Label | Meaning |
|---|---|
| `done` | Epic delivered, tickets closed |
| `needs-spec` | No written spec yet — next step is `to-spec`/`writing-plans` |
| `ready-for-agent` | Spec exists; fully specified for an AFK agent |

## Legend for blocker edges

- **A ← B** means **A is blocked by B** (B must complete first). Rendered on GitHub as
  native issue dependencies (`blocked_by`). A ticket is unblocked when all its blockers
  are closed. Completed items must not retain blocker edges — when a ticket/epic closes,
  its `blocked_by` edges and the children's `Blocked by` lines are removed (see
  "Dependency hygiene" in `docs/agents/issue-tracker.md`).

---

## Vision

Lekhan is the AI-native knowledge workspace that is local-first like Obsidian,
collaborative like Notion, and runs AI on your terms — cloud providers or your own
machine. **One knowledge graph, many views:** pages are nodes; backlinks, graph,
databases, wikis, and later sheets/slides/mail/chat are views over the same graph.
This suite substrate is the H0 data-model decision (approach B, architect now).

---

## H0 — Global Foundation (first release) `h0`

Launch requirement: **nothing ships in H0 unless it is global-ready** (i18n, billing,
provider registry).

> **Delivery estimates:** dates assume **6–8 focused hours/day** (one `M` ticket ≈ 1 day,
> one `L` ≈ 2). Each ticket's `Start date`, `Target date`, and `Estimate` (hours) live on
> the Lekhan project board — the tracker is the source of truth; this file mirrors it.
> Dates on `needs-spec` epics are **provisional** (spec first, then tickets).

### Delivered `done`

| Epic | Issue | Notes |
|---|---|---|
| P1 — Pages Graph Foundation (schema + graph index + sync cutover) | #8 | `workspaces`, `pages`, `page_links`, `page_tags`, `page_versions`; graph index service |
| P2 — Client Cutover onto the Pages Graph | #9 | Progressive migration; app fully on the graph |
| H0 — Global Search (index-native, keyboard-first) | #25 | Tickets #33–#36 done; shipped in PR #37 |
| H0 — Product analytics: event instrumentation for PMF funnel | #83 | Dual-destination PostHog EU + GA4, privacy sanitization, PMF funnel events |
| H0 — Encrypt page snapshots at rest (ADR 0001) | #81 | AES-256-GCM envelope encryption with magic header LK_ENC_V1, key rotation, backfill script |

| Epic | Issue | Blocker edges | Notes |
|---|---|---|---|
| H0 — Tauri Desktop Shell (vault-on-disk, llama.cpp sidecar, Model Library) | #88 | parallel with #28 | promoted from #43 (2026-08-24): delivers ADR 0003 files-on-disk promise; Model Library built once against sidecar; founding-cohort headline moment; not a beta gate |

### In progress — specced `ready-for-agent`

| Epic | Issue | Tickets | Blocker edges | Delivery | Spec ref |
|---|---|---|---|---|---|
| H0 — Markdown Import/Export (full round-trip) | #26 | MI-T1 #56 → MI-T2 #57 → MI-T3 #58 → MI-T4 #59 — **all done** | — | delivered Aug 20 · epic closed | §13 · `docs/superpowers/specs/2026-08-14-h0-markdown-import-export-design.md` |
| H0 — Obsidian Importer | #27 | OI-T1–T4 all done (#60, #61, #62/#80, #63/PR #86) | — | delivered Aug 24 · epic closed · pipeline feeds #78 | §13 · `docs/superpowers/specs/2026-08-14-h0-obsidian-importer-design.md` |

### Delivery plan (recalibrated Aug 24 · velocity-based)

> **Estimation policy:** estimates are recalibrated against actual delivery at every
> epic close. Measured basis: Aug 13–24 window = 14 merged PRs in 11 days; all six
> hour-estimated tickets landed on time or 1–3 days early. Calibration rules:
> familiar-pattern work ×0.9 (mirrors in-repo prior art) · novel-integration work
> ×1.5 + named external buffers (no precedent yet: billing, Tauri, Rust sidecar,
> encryption key mgmt). Review-round tax is included, not added on top.
> **Recalibration checkpoints: after #81 ships (first novel item), after #29.**

### Lane A — Beta & Public Launch `p0`

| # | Work | Priority | Est | Start → Target | Status |
|---|---|---|---|---|---|
| #85 | Early-access page + Brevo waitlist | P0 | 12h | Aug 24 | **Shipped** (#91, a day early) |
| #83 | Analytics events | P0 | 8h | Aug 27 | **Shipped** (PR #95) |
| #81 | Encrypt-at-rest (spec + impl) | P0 | 16h | Aug 28 → Aug 29 | **Shipped** (PR #96) |
| #82 | Tier plumbing + local-first version history | P0 | 16h | Aug 31 → Sep 1 | **Shipped** (PR #99) |
| — | 🔒 **Private beta opens** (gate #84 clears) | — | — | **Sep 2** | — |
| #28 | AI Provider Registry (final spec 4h incl.) | P0 | 64h | Sep 2 → Sep 10 | In review (seed) |
| #29 | Billing: Stripe/Razorpay + founding prices + referral credits | P0 | 60h | Sep 11 → Sep 22 | Backlog |
| #87 | Idempotent imports | P1 | 12h | Sep 23 → Sep 24 | Backlog |
| #31 | i18n framework | P0 | 24h | Sep 25 → Sep 29 | Backlog |
| #32 | Docs site (agent 32h; prose content owner-driven in parallel) | P0 | 32h | Sep 30 → Oct 7 | Backlog |
| #30 | Publish polish | P0 | 12h | Oct 8 → Oct 9 | Backlog |
| — | 🚀 **Public launch** | — | — | **Oct 12** (aggressive Oct 8) | — |

*#85 inserted ahead of beta: content funnel has no conversion target without it. Shipped Aug 24 (#91): /early live, self-hosted double opt-in over Brevo transactional, race-safe spot numbering, outbox retry drain.*

### Lane B — Founding Desktop `p1`

| # | Work | Priority | Est | Start → Target | Status |
|---|---|---|---|---|---|
| #88 | Spec pass | P1 | 4h | Sep 2 (parallel, light) | Backlog |
| #88-M1 | Shell + vault-on-disk + sync (ADR 0003 live) | P1 | 48h | Oct 13 → Oct 20 | Backlog |
| #88-M2 | llama.cpp sidecar + Model Library | P1 | 64h | Oct 21 → Nov 3 | Backlog |
| — | 💻 **Founding-cohort desktop delivery** | — | — | **~Nov 3** | — |

Mobile (#43) follows desktop; PWA covers interim. #78 slices + Notion import
begin H1-proper in November, unblocked once #87 lands.

**Also shipped:** #70 — mentions in `.md`/`.mdx` export (bug, PR #71), Aug 19.

**Sequencing narrative:** the import pipeline is the shared foundation — Markdown
Import/Export (#26) establishes the `importer → IR → graph` pipeline, and Obsidian
Importer (#27) delivered it end-to-end (closed Aug 24); #78 consumes the same
pipeline for Notion once #87 (idempotent imports) lands. Docs Site (#32) remains a
launch requirement. AI Provider Registry (#28) is the cost-safety keystone: every
tier runs on the user's own keys or machine, so it must be live before launch and
unblocks H2 agents. The Tauri desktop shell (#88) delivers the files-on-disk promise
(ADR 0003) and the Model Library as the founding-cohort moment.

---

## H1 — PKM Depth ("The Second Brain") `h1`

> **Target:** opens once the H0 import pipeline lands (epics #26/#27 done ≈ **Aug 26**). Desktop shell pulled forward into H0 as #88.
> First H1 epic is #39 (no blockers) — ~**early Oct** for the earliest H1 items once
> H0's `needs-spec` epics and H1 speccing happen. Dates are provisional; re-baseline at
> the H0→H1 handoff.

| Epic | Issue | Blocker edges | Spec ref |
|---|---|---|---|
| H1 — Graph view + backlink pane | #38 | → H2 Databases #47 (blocker) | §4 |
| H1 — Dual-Dialect Interop Bridge (Obsidian-native files + Notion-compatible content) | #78 | ← #27; subsumes the import half of #45 | `docs/superpowers/specs/…` (spec in issue body) |
| H1 — Daily notes / quick capture / inbox | #39 | — | §4 |
| H1 — Public pages + publish | #40 | ← #30 | §4 |
| H1 — Comments + page mentions | #41 | — | §4 |
| H1 — Templates | #42 | — | §4 |
| H1 — Mobile apps (Tauri iOS/Android) + PWA interim | #43 | — | desktop split into #88 (H0) |
| H1 — Plugins API v1 + open-core release | #44 | → H2 Plugin marketplace #51 (blocker) | §8 |
| H1 — Notion importer | #45 | ← #87 (idempotent imports); import half absorbed into #78 | §13 + #78 constraints |
| H1 — Full docs (tutorials, plugin/API ref, migration guides) | #46 | ← #32, ← #31 | §12 |

**Sequencing narrative:** H1 is where the PKM story deepens. Graph view (#38) is the
headline feature and becomes the substrate H2 databases render over. The Interop
Bridge (#78) is the underdog wedge — Lekhan as the compatibility layer between the
Obsidian and Notion dialects (import, one-click export both ways, clipboard fluency);
it rides the #26/#27 import pipeline and absorbs the import half of the Notion
importer (#45). Plugins API v1
(#44) is the open-core unlock and unblocks the H2 marketplace. The Notion importer
(#45) rides the H0 import pipeline. Full docs (#46) cannot be written until both the
docs site (#32) and i18n (#31) exist.

---

## H2 — Notion-Grade Structure ("The Workspace") `h2`

| Epic | Issue | Blocker edges | Spec ref |
|---|---|---|---|
| H2 — Databases as typed views | #47 | ← #38; → H3 Sheets #52, H3 Slides #53 (blockers) | §4 |
| H2 — Block references | #48 | — | §4 |
| H2 — Team workspaces, admin, SSO, guest sharing | #49 | ← #29 | §4 |
| H2 — AI agents | #50 | ← #28; → H3 Mail #54, H3 Chat #55 (blockers) | §4 |
| H2 — Plugin marketplace + themes | #51 | ← #44 | §4 |

**Sequencing narrative:** databases (#47) are typed views over the graph — they
inherit the H1 graph substrate and feed the H3 sheets/slides. Team workspaces (#49)
needs workspace-root billing (#29) as its entitlement basis. AI agents (#50) run on
the provider registry (#28) and power the H3 mail/chat agents. The marketplace (#51)
is distribution for the H1 plugin API.

---

## H3 — The Suite ("AI-Native Office") `h3`

| Epic | Issue | Blocker edges | Spec ref |
|---|---|---|---|
| H3 — Sheets (grids over properties) | #52 | ← #47 | §4 |
| H3 — Slides (ordered page decks) | #53 | ← #47 | §4 |
| H3 — Mail (threads as linked pages) | #54 | ← #50 | §4 |
| H3 — Chat (agent workspace with graph context) | #55 | ← #50 | §4 |

**Sequencing narrative:** H3 modules are *views over the same graph*, so each rides
its H2 predecessor — sheets/slides on databases, mail/chat on AI agents. Suite
pricing (bundled in Pro/Team; enterprise per-module) rides the billing foundation
from #29 and is deliberately not a separate epic until H3 work begins.

---

## Open questions / unrecorded

- **Suite pricing** is tracked narratively (rides #29), not as its own epic — create
  one when H3 planning begins.
- Strategy §11 lists required specs per horizon; each `needs-spec` epic above maps to
  one. Work order for specs should follow the blocker edges.
- Desktop app (#43) has no forward blockers — it can start whenever H1 opens.
