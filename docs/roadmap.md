# Lekhan Product Roadmap

> **Single source of truth: the GitHub issue tracker.** Every roadmap item below is an
> epic on the tracker; dependency edges are recorded as native GitHub blockers
> (`blocked_by`). This document mirrors those epics, adds the sequencing narrative,
> and keeps the full product picture survivable across sessions. If tracker state
> and this file disagree, the tracker wins — update this file to match.
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

### In progress — specced `ready-for-agent`

| Epic | Issue | Tickets | Blocker edges | Delivery | Spec ref |
|---|---|---|---|---|---|
| H0 — Markdown Import/Export (full round-trip) | #26 | MI-T1 #56 → MI-T2 #57 → MI-T3 #58 → MI-T4 #59 — **all done** | — | delivered Aug 20 · epic closed | §13 · `docs/superpowers/specs/2026-08-14-h0-markdown-import-export-design.md` |
| H0 — Obsidian Importer | #27 | OI-T1–T4 all done (#60, #61, #62/#80, #63/PR #86) | — | delivered Aug 24 · epic closed · pipeline feeds #78 | §13 · `docs/superpowers/specs/2026-08-14-h0-obsidian-importer-design.md` |

### Remaining `needs-spec` — provisional targets (spec first)

| Epic | Issue | Blocker edges | Provisional target | Spec ref |
|---|---|---|---|---|
| H0 — AI Provider Registry | #28 | → H2 AI agents #50 (blocker) | Aug 27 – Sep 4 | §6 |
| H0 — Real Billing (Stripe + Razorpay) | #29 | → H2 Team workspaces #49 (blocker); H3 suite pricing rides on it | Sep 5 – Sep 12 | §7 |
| H0 — Public Pages / Publish polish | #30 | → H1 Public pages + publish #40 (blocker) | Sep 13 – Sep 17 | §4 (H1 scope note in epic) |
| H0 — i18n Framework | #31 | → H1 localized docs (edge on #46) | Sep 18 – Sep 24 | §4 |
| H0 — Docs Site (docs.lekhan.app) | #32 | → H1 Full docs #46 (blocker) | Sep 25 – Sep 30 | §12 |

### H0 ticket schedule (Start → Target · hours)

| Ticket | Issue | Start | Target | Est. | Status |
|---|---|---|---|---|---|
| MI-T3 — MDX + HTML export | #58 | Aug 19 | Aug 19 | 6h | Done |
| MI-T4 — Markdown import | #59 | Aug 20 | Aug 20 | 6h | Done |
| OI-T1 — Callout node | #60 | Aug 21 | Aug 21 | 6h | Done |
| OI-T2 — Vault ingestion → IR | #61 | Aug 22 | Aug 23 | 14h | Done |
| OI-T3 — /api/import route | #62 | Aug 24 | Aug 25 | 12h | Done (early) |
| OI-T4 — Import UX + report | #63 | Aug 26 | Aug 26 | 6h | Ready |

**Also shipped:** #70 — mentions in `.md`/`.mdx` export (bug, PR #71), Aug 19.

**Sequencing narrative:** the import pipeline is the shared foundation — Markdown
Import/Export (#26) establishes the `importer → IR → graph` pipeline, and Obsidian
Importer (#27) is the first real importer on it (and lands the first-class callout node
in the shared round-trip schema). Both must land before the H1 Notion importer (#45). Docs Site (#32) is a launch requirement and unblocks the H1 docs
depth. AI Provider Registry (#28) is the cost-safety keystone: every tier runs on the
user's own keys or machine, so it must be live before launch and unblocks H2 agents.

---

## H1 — PKM Depth ("The Second Brain") `h1`

> **Target:** opens once the H0 import pipeline lands (epics #26/#27 done ≈ **Aug 26**).
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
| H1 — Desktop app (Tauri) + mobile PWA | #43 | — | §4 |
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
