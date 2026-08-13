# Lekhan Global Strategy: AI-Native PKM Workspace & Office Suite

**Date:** 2026-08-12
**Status:** Approved (strategy)
**Goal:** Transform Lekhan from an India-focused collaborative editor into a global, AI-native personal knowledge management (PKM) workspace that combines Obsidian's local-first ownership with Notion's collaboration and structure, positioned as the first module of a complete set of AI-native office tools.

---

## 1. Current State Assessment

### 1.1 Strengths (what we keep)
- **Local-first architecture**: Yjs CRDT + IndexedDB + server WAL + y-websocket sync; changes persist locally and sync asynchronously (`server/index.js`, `server/wal.js`).
- **Real-time collaboration**: Tiptap v3 + y-prosemirror, collaboration cursors, role-based permissions (owner/editor/viewer), invites.
- **Offline support**: open, edit, close documents fully offline; conflict resolution on reconnect.
- **Version history**, markdown paste handling, export (PDF/DOCX/HTML).
- **AI foundations**: Lekhan Bot (`lekhan-bot-bar.tsx`), Sarvam-first BYOK with AES-256-GCM client-side encryption (`lib/crypto.ts`), credits ledger (`profiles.plan`, `used_credits`).
- **Testing discipline**: Vitest unit + Playwright E2E suites.

### 1.2 Gaps vs. Notion and Obsidian
- Flat `documents` table — no hierarchy, workspaces, tags, backlinks, or graph.
- No databases/templates/wikis/public pages (`is_public` column exists but unused).
- AI locked to Sarvam; brand positioned as "Indian writing assistant".
- INR-only pricing with a 5-document free cap; checkout is a toast mock.
- Web-only (no desktop/mobile apps).

### 1.3 Positioning insight
Notion = the **team brain** (structured, collaborative, all-in-one; costs: slow, cloud-locked, weak offline, data lock-in). Obsidian = the **personal brain** (local markdown files, backlinks, graph; costs: no native collaboration, paid sync, plugin-chaos AI). Neither is local-first *and* collaborative *and* AI-native. The contested gap (AFFiNE, Anytype, AppFlowy) validates it.

---

## 2. Strategic Decisions (locked)

1. **Wedge**: Obsidian-style PKM, local-first, with AI on the user's terms.
2. **Persona**: generalist (not developer-only, not team-only).
3. **Monetization**: subscription (per workspace); generous free tier; no AI usage credits.
4. **Source**: open-core + plugin API (trust + community flywheel; proprietary moat = managed cloud layer).
5. **Approach**: **B — architect now**. Restructure the data model into pages-as-nodes knowledge graph as the first milestone, then ship in horizons. Progressive migration; current app stays usable throughout.

**Vision statement:** *Lekhan is the AI-native knowledge workspace that is local-first like Obsidian, collaborative like Notion, and runs AI on your terms — cloud providers or your own machine.*

**Core principle:** One knowledge graph, many views. Pages are nodes; backlinks, graph, databases, wikis, and later sheets/slides/mail/chat are views over the same graph. This is the suite substrate.

---

## 3. Data Model (Approach B substrate)

| Table | Purpose | Notes |
|---|---|---|
| `workspaces` | Vault/workspace root (personal or team) | Maps to plan/billing |
| `pages` | The universal node — replaces flat `documents` | `parent_id` for nesting; `properties JSONB` for frontmatter; `icon`, `cover`, `is_public` |
| `page_links` | Link index (as implemented in H0): `workspace_id`, `from_page_id`, `to_page_id` (nullable — unresolved wikilinks), `to_title`, `block_id` (reserved, always NULL in H0), `created_at`; UNIQUE(`from_page_id`, `to_title`) | Obsidian backlinks + Notion block refs = one table; maintained incrementally by the graph index service. `block_id` semantics (block refs) deferred to H2; `created_by` dropped (derivable from page history) |
| `page_tags` | #tag index: `page_id`, `tag`, `created_at`; UNIQUE(`page_id`, `tag`) | For graph filters |
| `page_versions` | Version history (migrate existing `document_versions` pattern) | |

**What does NOT change (de-risking):**
- Per-page Yjs docs stay — CRDT collab engine, WAL, offline sync, cursors unchanged; only *structure* moves to relational tables.
- Progressive migration: `documents` → `pages` via cutover column; row-by-row; app stays shippable throughout.
- New **graph index service** (server-side): consumes the Yjs update stream, incrementally extracts `[[links]]`, tags, and search tokens — backlinks/graph/search are index-native, not text-scanned.

**Later leverage:** Databases = typed views over `properties` + `links`. Slides = ordered page views. Sheets = grid views over properties. The suite becomes rendering, not rewriting.

---

## 4. Roadmap Horizons

### H0 — Global Foundation (first release)
- Schema migration (Section 3) with progressive cutover.
- Workspaces + nested pages + tags + backlinks/mentions (`[[page]]`).
- Global search (index-native, keyboard-first).
- Markdown import/export (full round-trip — escape hatch is a growth channel).
- **Obsidian importer** (Section 13) — markdown + conventions: wikilinks, frontmatter, vault zip/folder, attachments.
- i18n framework (UI in en/hi/zh/es/de...; Indic language support becomes a feature, not the identity).
- **AI provider registry** (Section 6): free-key on-ramp presets + BYOK cloud + BYOL local; `app/api/ai` becomes a thin provider-agnostic router (no credits ledger — Section 6.3).
- Real billing: Stripe (global) + Razorpay (India); webhooks; plan tiers table; reuse existing enforcement plumbing. Retire the doc cap.
- USD headline pricing + INR regional pricing (Section 7).
- **Docs site live at launch** (`docs.lekhan.app`, Section 12) — getting started, core concepts, AI setup guides.

### H1 — PKM Depth ("The Second Brain")
- Graph view + backlink pane (Obsidian-grade, real-time via the link index).
- Daily notes / quick capture / inbox.
- Public pages + publish (personal sites as viral channel).
- Comments + page mentions (collab upgrade).
- Templates; community marketplace later.
- Desktop app (Tauri) + mobile PWA (offline-first apps are table stakes).
- **Plugins API v1** (Section 8) + open-core release.
- **Notion importer** (Section 13) — native export zip (HTML + CSV), block mapping, database CSVs → pages with properties.
- Full docs: tutorial library, plugin/API reference, **migration guides**, localized docs following i18n releases (Section 12).

### H2 — Notion-Grade Structure ("The Workspace")
- Databases as typed views: table/board/calendar/gallery over `properties`.
- Block references (Notion-style `(block ref)`) over the `links` index.
- Team workspaces, admin, SSO, guest sharing.
- AI agents: auto-organize, note-linker, meeting-notes-to-graph, Q&A over workspace.
- Plugin marketplace + themes.

### H3 — The Suite ("AI-Native Office")
- Sheets (grids over `properties`), Slides (ordered page decks), Mail (threads as linked pages, AI-drafted), Chat (agent workspace with graph context).
- One mesh: all modules share the graph, link index, provider registry, agent runtime, plugin SDK.
- Lekhan becomes the Docs module of a complete AI-native office set.
- Suite pricing: bundled in Pro/Team; enterprise licenses per module.

**Deliberately out of scope until H2:** databases, plugin API, team SSO. **YAGNI:** block-level refs deferred to H2; page-level links carry the PKM story.

---

## 5. Competitive Positioning

| Dimension | Lekhan (target) | Notion | Obsidian |
|---|---|---|---|
| Storage | Local-first + optional cloud sync | Cloud | Local files |
| Collaboration | Real-time, built-in | Real-time | None native |
| AI | Provider registry: free-key presets / BYOK / BYOL | Notion AI (paid add-on) | Plugins |
| Privacy | Local-first + BYOL total-privacy path | Cloud | Local, but paid sync |
| Extensibility | Sandboxed plugin API (open-core) | Limited API | Unsandboxed plugins |
| Price | Below Notion, above Obsidian; every tier BYOK/BYOL (no bundled credits) | $10/mo + $8/mo AI add-on | Sync $4/mo (annual) / $5/mo (monthly) per user; Publish $8/mo (annual) / $10/mo (monthly) per site; vault collaboration only via Sync (no native real-time) |

*Obsidian pricing as of Aug 2026 (source: [obsidian.md/pricing](https://obsidian.md/pricing)) — per user for Sync, per site for Publish; no team/concurrent-edit plan exists natively.*

**Wedge vs Obsidian:** working AI in ~2 minutes for non-technical users (guided free-key on-ramp with deep links), with a one-click path up to BYOK/BYOL for privacy.
**Wedge vs Notion:** local-first speed, offline, ownership, and lower price with AI included.
**Cost safety:** Lekhan never incurs AI costs for free users (per-user free-tier keys; BYOK/BYOL run on user keys/machines).

---

## 6. AI Provider Layer

### 6.1 Provider registry (config-driven, Pi/opencode/Hermes-style)
- Users add providers: cloud BYOK (Anthropic, OpenAI, Gemini, Sarvam, others), local endpoints (**BYOL**: Ollama, LM Studio, llama.cpp, anything OpenAI-compatible), custom URLs.
- Model routing per request; provider dropdown in bot panel + settings; AES-256 encrypted-key storage (`lib/crypto.ts`) generalizes to N providers.
- `app/api/ai` becomes a thin provider-agnostic router. All inference goes direct from the client to the chosen provider (or to the user's local endpoint) — Lekhan never proxies AI traffic, never hosts an inference key.

### 6.2 Free-tier AI access (free-key on-ramp, all cost-safe)

| Access path | Who | Cost to Lekhan |
|---|---|---|
| **Free-key on-ramp** (guided BYOK): curated free-tier provider presets — OpenRouter free models, Gemini API free tier, Groq, Mistral (instant issuance, no card). First AI use opens a "Connect AI" wizard: deep links to issue a key, paste into the existing BYOK flow, encrypted locally (`crypto.ts`). Each user runs on their own provider quota — **rate limits are theirs, not ours** | Non-technical users | $0 (user's own key/quota) |
| **BYOK** (cloud): Anthropic/OpenAI/Gemini/Sarvam + custom | Power users with keys | $0 (direct client-side calls) |
| **BYOL** (local): Ollama/LM Studio/llama.cpp | Privacy-first users | $0 (runs on their machine) |

- Router: free tier → on-ramp presets (per-user keys) · always fall back to BYOK/BYOL if configured. **No Lekhan-hosted inference anywhere, no bundled credits on any tier — every tier runs on the user's own keys or their own machine.**
- **Managed Lekhan-key path: dropped from H0** — zero cost, zero rate-limit ops, zero key-ban management. Revisit only if onboarding analytics show the key-step is a hard bounce point; even then it would be a tightly-limited "instant try" (e.g., a capped managed free-model path).
- Local LLM detection (ping Ollama/LM Studio from the browser) is new work in H0.
- UI copy must label free models as "free models may change/be slower" to avoid entitlement claims.
- Preset list curation is ongoing work (provider availability changes); initial integration: OpenRouter free models.

### 6.3 No credits ledger (retired)
- The H0-era credits tables and `used_credits` enforcement are retired with the P2 cutover. There is nothing to meter: subscription revenue is decoupled from AI entirely, and unit economics are guaranteed by construction — AI cost is never Lekhan's line item because no AI runs on Lekhan infra (Section 6.1).
- Remaining enforcement is only about *what a tier unlocks* (seats, collaborators, history, sync), not *how much AI a user consumed*.

---

## 7. Global Readiness & Pricing

### 7.1 Positioning changes
- Headline language goes global: "AI-native knowledge workspace". Indic languages remain first-class AI/UI features, not the brand.
- Currency: **USD headline, INR regional pricing** (PPP ~40-60% of USD); Stripe globally + Razorpay in India.
- **Entitlement root = workspace** (the vault), not the user account. Subscriptions attach to a workspace and unlock every page, seat, and sync relay inside it. This matches the product model (a workspace is the collaboration unit) and keeps billing trivial to reason about: one subscription per vault, seats bill on top for Team.
- **Migration from `profiles.plan`**: the existing per-user plan column moves once, at signup time, to the owner's personal workspace as a one-time backfill (plan, `used_credits` enforcement patterns, and the doc cap are retired together with the cutover). Future plan changes happen at the workspace level; `profiles.plan` becomes a deprecated read-only mirror until the P2 client cutover.
- Real billing in H0: Stripe/Razorpay webhooks + plan tiers table keyed by `workspaces.id`; a workspace's owner holds the subscription and can transfer ownership.

### 7.2 Tier matrix (subscription per workspace)

Subscriptions are per workspace; seats are per workspace member. AI on every tier runs on the user's own keys or machine (Section 6) — no bundled credits anywhere.

| Tier | Price (USD / INR) | Unlocks |
|---|---|---|
| **Free** | $0 / ₹0 | Unlimited local pages (doc cap retired), PKM core (backlinks, graph, tags, search), markdown, AI via guided free-key on-ramp (free-tier provider presets) + BYOK + BYOL, 2 editors/doc, 7-day history |
| **Plus** | $6/mo / ₹499/mo per workspace | Cloud sync (unlimited), 10 collaborators, 90-day history, templates |
| **Pro** | $12/mo / ₹999/mo per workspace | 25 collaborators, 1-year history, priority sync/processing, public sites |
| **Team** | $10/seat/mo / ₹799/seat/mo per workspace | Workspace subscription + per-seat billing, admin, shared templates, guest access, 2-150 seats |
| **Enterprise** | Custom | SSO/SAML, dedicated infra, SLA, on-prem LLM (BYOL), volume seats |

### 7.3 Strategic pricing decisions
1. **Generous free tier** because serving cost is ~zero (local-first). The 5-doc cap punished exactly the PKM use case — retired. Free is a growth engine.
2. **All BYOK/BYOL, no bundled credits** — every tier runs on the user's own provider keys or local endpoints; Lekhan never hosts inference or a credits ledger (retires the Sarvam-first BYOK flow in `byok-settings.tsx` and the credits tables).
3. **Explicit regional pricing** — INR keeps existing users (₹499/mo Plus ≈ today's Pro price); USD captures global willingness-to-pay.
4. **Workspace as the billing root** — one subscription per vault keeps pricing legible (per-seat only on Team), and a plan change touches one object, not N user rows.

---

## 8. Open-Core Boundary & Plugin API

### 8.1 Boundary (drawn at the trust/perimeter line)

| Open (community) | Proprietary (hosted, paid) |
|---|---|
| Editor + Tiptap extensions | Managed cloud sync + relay |
| Local-first sync engine (Yjs/WAL) | Real-time collab server infra |
| PKM core: graph, backlinks, tags, search | Managed sync + collab server infra |
| Markdown import/export, provider registry | Team admin, SSO, billing |
| Plugin SDK + API | Publish hosting |

The line is where *running on our infra* begins. Everything on a user's device is open. The moat is the managed layer (Obsidian's sync model, plus collab + AI convenience).

### 8.2 Plugin API v1 (H1)
- Typed SDK over the graph: read/write pages, links, tags, properties — first-class data access, not DOM hacking.
- Extension points: sidebar panels, block-level extensions (Tiptap shape), slash commands, themes.
- **Sandboxed runtime** (Web Worker + iframe + postMessage) — a real improvement over Obsidian's unsandboxed community plugins.
- Validation criterion: *a plugin written by a stranger cannot exfiltrate the vault without consent.*

**Capability model** (security contract every plugin ships against):
- **Permissions**: capabilities are declared at install time as the minimal set of graph scopes (e.g., `read:pages`, `write:pages`, `read:graph`, `http:<origin-allowlist>`) and granted by explicit user consent, one consent per plugin. Capability checks happen in the host on every message, never inside the sandbox.
- **Consent & revocation**: a consent registry (per plugin × per workspace) persists in storage; users can revoke any capability (or the whole plugin) at any time; revocation takes effect on the next message and blocks pending ones. Consent prompts show exactly the data each scope touches.
- **Origins & CSP**: plugins load from an allowlisted origin (marketplace) or a hashed local bundle; the app CSP forbids `unsafe-eval` and restricts `frame-src` to the plugin sandbox origin; no plugin code ever runs in the host's main thread.
- **postMessage validation**: every message is validated — `event.origin` checked against the sandbox origin, a per-session nonce prevents replay, and the payload schema is validated before dispatch to any host API.
- **Hostile-plugin tests**: the API test suite ships attack fixtures (exfiltration attempts via DOM, network, storage, crypto APIs; capability overreach; malformed/hostile messages) and must pass before any runtime change ships.
- **Release criteria**: a plugin can only be published after a static review passes (no dynamic execution on the host), the capability declaration matches actual API usage (verified by an analyzer), and the hostile-plugin suite passes against the current host build.
- Marketplace + themes in H2.

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Approach B delays global launch | Progressive migration keeps current app shippable; launch H0 scope disciplined |
| OpenRouter free models rate-limited/congested | Per-user keys make limits the user's concern, not ours; label free models clearly; no paid credits to sell against — users upgrade providers themselves; rotate preset list as availability changes |
| Scope creep (Notion-parity expectations) | YAGNI guardrails: databases, block refs, plugins, SSO all explicitly deferred to H2 |
| Forking risk from open-core | Moat is managed sync + collab + AI convenience, not the editor |
| Free tier abuse | No bundled credits on any tier; no Lekhan-hosted inference; per-user keys and provider rate limits bound abuse |

---

## 10. Out of Scope / Deferred
- Notion-style databases, block references, plugin marketplace, team SSO → H2.
- Desktop/mobile apps, publish, comments → H1; plugin API v1 (Section 8.2) → H1; plugin marketplace + themes → H2.
- Nothing from H0 ships unless it is global-ready (i18n, billing, provider registry).

## 11. Future Specs Required
- H0: schema migration + graph index service design; provider registry + free-key on-ramp design; billing/Stripe/Razorpay design; i18n framework design; docs site (Fumadocs) setup design; import pipeline + Obsidian importer design.
- H1: plugin API + sandboxing design; graph view UX; publish design; desktop/mobile app plan; Notion importer design.
- Each spec → its own implementation plan (writing-plans).

---

## 12. Documentation & Community (`docs.lekhan.app`)

- **Platform:** Fumadocs (open-source Next.js docs framework — matches the existing stack; Tailwind, MDX) served on `docs.lekhan.app`. Mintlify is the managed alternative if self-hosting is undesirable. Recommendation: Fumadocs, because docs live **in the open-core repo as markdown** — versioned with releases, PR-based community contributions, zero platform lock-in. Docs subdomain keeps the marketing site (`lekhan.app`) separate from help content.
- **Structure:**
  - *Getting Started* — quickstart, core concepts (pages, workspaces, backlinks, graph, tags), markdown import/export.
  - *Guides* — daily notes, quick capture, knowledge workflows, collaboration.
  - *AI* — free-key on-ramp walkthrough, BYOK setup, **BYOL guides (Ollama/LM Studio)** — where the "your AI never leaves your machine" story gets told.
  - *Troubleshooting + FAQ + Changelog*.
  - *Developer* (H1+, with plugins v1) — plugin SDK reference, sandboxing guide.
- **Timeline:** H0 — basic docs live **at global launch** (getting started + concepts + AI setup; a launch requirement, not a nicety). H1 — full tutorial library + plugin/API reference; localized docs follow i18n releases.
- **Why it matters:** Obsidian's help docs are its #1 organic acquisition channel (rank for "backlinks", "graph view", "markdown notes"). Guides target high-intent PKM keywords and compound with the open-core community flywheel; documentation is a trust artifact for a privacy-first product.

---

## 13. Migration & Lock-in Reversal

**Strategic framing:** "Your data stays, the tool changes" — the anti-lock-in play. Obsidian's own pitch to Notion users works against Notion (markdown portability); we extend it to Obsidian by adding collaboration + AI on top of the same data. Migration guides in docs (Section 12) are an SEO engine targeting "import from Notion" / "move from Obsidian" searches.

**One import pipeline, multiple importers:**
`importer (obsidian / notion / markdown) → normalize to intermediate representation (pages + blocks + properties + links) → write into the graph`. Future importers (Evernote, Apple Notes) plug into the same pipeline; community importers possible via the plugin API later.

**Obsidian importer (H0 — markdown + conventions):**
- Zip upload or folder picker (File System Access API).
- Preserve: folder hierarchy → nested pages; `[[wikilinks]]` → link index entries; frontmatter → `properties JSONB`; `#tags`; attachments (`![[...]]`); callouts, code blocks, embeds.
- Deferred: Canvas files (→ board view in H2), graph-layout metadata.

**Notion importer (H1):**
- Native export zip (HTML per page + CSVs for databases).
- Map Notion blocks → Tiptap nodes (headings, lists, to-dos, toggles, callouts, tables, images, code, math); database CSVs → pages with `properties` (data lands ready for typed views in H2).
- Deferred with degradation notice: embeds, comments, guest permissions.

**Import experience is a product feature, not a utility:**
- Import report: "X pages · Y links resolved · Z blocks degraded" — honest fidelity expectations, no silent data loss.
- Migration guides end with the pricing comparison — the capture funnel for Notion refugees and Obsidian users who want collab + AI without losing their vault.
