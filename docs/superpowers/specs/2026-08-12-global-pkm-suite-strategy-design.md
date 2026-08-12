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
3. **Monetization**: subscription + AI usage credits; generous free tier.
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
| `links` | Link index: `from_page_id`, `to_page_id`, `block_id`, `created_by` | Obsidian backlinks + Notion block refs = one table; maintained incrementally |
| `tags` | #tag index | For graph filters |
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
- i18n framework (UI in en/hi/zh/es/de...; Indic language support becomes a feature, not the identity).
- **AI provider registry** (Section 6): managed OpenRouter free models + BYOK cloud + BYOL local; one credits ledger; `app/api/ai` becomes a thin provider-agnostic router.
- Real billing: Stripe (global) + Razorpay (India); webhooks; plan tiers table; reuse existing enforcement plumbing. Retire the doc cap.
- USD headline pricing + INR regional pricing (Section 7).

### H1 — PKM Depth ("The Second Brain")
- Graph view + backlink pane (Obsidian-grade, real-time via the link index).
- Daily notes / quick capture / inbox.
- Public pages + publish (personal sites as viral channel).
- Comments + page mentions (collab upgrade).
- Templates; community marketplace later.
- Desktop app (Tauri) + mobile PWA (offline-first apps are table stakes).
- **Plugins API v1** (Section 8) + open-core release.

### H2 — Notion-Grade Structure ("The Workspace")
- Databases as typed views: table/board/calendar/gallery over `properties`.
- Block references (Notion-style `(block ref)`) over the `links` index.
- Team workspaces, admin, SSO, guest sharing.
- AI agents: auto-organize, note-linker, meeting-notes-to-graph, Q&A over workspace.
- Plugin marketplace + themes.

### H3 — The Suite ("AI-Native Office")
- Sheets (grids over `properties`), Slides (ordered page decks), Mail (threads as linked pages, AI-drafted), Chat (agent workspace with graph context).
- One mesh: all modules share the graph, link index, provider registry, credits ledger, agent runtime, plugin SDK.
- Lekhan becomes the Docs module of a complete AI-native office set.
- Suite pricing: bundled in Pro/Team; enterprise licenses per module.

**Deliberately out of scope until H2:** databases, plugin API, team SSO. **YAGNI:** block-level refs deferred to H2; page-level links carry the PKM story.

---

## 5. Competitive Positioning

| Dimension | Lekhan (target) | Notion | Obsidian |
|---|---|---|---|
| Storage | Local-first + optional cloud sync | Cloud | Local files |
| Collaboration | Real-time, built-in | Real-time | None native |
| AI | Provider registry: free managed / BYOK / BYOL | Notion AI (paid add-on) | Plugins |
| Privacy | Local-first + BYOL total-privacy path | Cloud | Local, but paid sync |
| Extensibility | Sandboxed plugin API (open-core) | Limited API | Unsandboxed plugins |
| Price | Below Notion, above Obsidian, AI credits included | $10/mo + $8 AI | Sync $4-8/mo + Publish $8/mo |

**Wedge vs Obsidian:** working AI in ~10 seconds with zero setup for non-technical users (managed free models), with a one-click path up to BYOK/BYOL for privacy.
**Wedge vs Notion:** local-first speed, offline, ownership, and lower price with AI included.
**Cost safety:** Lekhan never incurs AI costs for free users (free models are $0-subsidized on OpenRouter; BYOK/BYOL run on user keys/machines).

---

## 6. AI Provider Layer & Credits

### 6.1 Provider registry (config-driven, Pi/opencode/Hermes-style)
- Users add providers: cloud BYOK (Anthropic, OpenAI, Gemini, Sarvam, others), local endpoints (**BYOL**: Ollama, LM Studio, llama.cpp, anything OpenAI-compatible), custom URLs.
- Model routing per request; provider dropdown in bot panel + settings; AES-256 encrypted-key storage (`lib/crypto.ts`) generalizes to N providers.
- `app/api/ai` becomes a thin provider-agnostic router. Free-tier managed calls may proxy through our server; BYOK/BYOL calls go direct — user keys never touch our servers.

### 6.2 Free-tier AI access (three paths, all cost-safe)
| Access path | Who | Cost to Lekhan |
|---|---|---|
| **Zero-config AI** (managed): OpenRouter free-model catalogue (`https://openrouter.ai/openrouter/free`) via our key, rate-limited (~20 req/min per key, 50 req/day per IP) | Non-technical users | $0 (models are free on OpenRouter) |
| **BYOK** (cloud): Anthropic/OpenAI/Gemini/Sarvam + custom | Power users with keys | $0 (direct client-side calls) |
| **BYOL** (local): Ollama/LM Studio/llama.cpp | Privacy-first users | $0 (runs on their machine) |

- Router: free tier → managed OpenRouter free models (our key, server-side; rotate keys if rate-limited) · paid tiers → bundled credits for premium models · always fall back to BYOK/BYOL if configured.
- Local LLM detection (ping Ollama/LM Studio from the browser) is new work in H0.
- UI copy must label free models as "free models may change/be slower" to avoid entitlement claims.
- Explore free endpoint providers with higher limits, or rotate between them (decision recorded; OpenRouter is the initial integration).

### 6.3 Credits ledger
- Provider-agnostic credits: one ledger across Sarvam/Anthropic/OpenAI/Gemini + free local.
- **No bundled AI on Free tier by default** — the three free paths above exist instead. Bundled credits are a convenience of paid plans, never a gate.
- Unit economics guaranteed: subscription revenue is the only AI cost-bearing line.

---

## 7. Global Readiness & Pricing

### 7.1 Positioning changes
- Headline language goes global: "AI-native knowledge workspace". Indic languages remain first-class AI/UI features, not the brand.
- Currency: **USD headline, INR regional pricing** (PPP ~40-60% of USD); Stripe globally + Razorpay in India.
- Real billing in H0: Stripe/Razorpay webhooks + plan tiers table; existing `profiles.plan` + `used_credits` enforcement reused as-is.

### 7.2 Tier matrix (subscription + AI credits)

| Tier | Price (USD / INR) | Unlocks |
|---|---|---|
| **Free** | $0 / ₹0 | Unlimited local pages (doc cap retired), PKM core (backlinks, graph, tags, search), markdown, zero-config AI via managed free models + BYOK + BYOL, 2 editors/doc, 7-day history, no bundled credits |
| **Plus** | $6/mo / ₹499/mo | Cloud sync (unlimited), 10 collaborators, 90-day history, 5,000 credits/mo, templates |
| **Pro** | $12/mo / ₹999/mo | 25 collaborators, 1-year history, 30,000 credits/mo, priority sync/processing, public sites |
| **Team** | $10/seat/mo / ₹799/seat/mo | Admin, pooled credits, shared templates, guest access, 2-150 seats |
| **Enterprise** | Custom | SSO/SAML, dedicated infra, SLA, pooled/unlimited credits, on-prem LLM |

### 7.3 Strategic pricing decisions
1. **Generous free tier** because serving cost is ~zero (local-first). The 5-doc cap punished exactly the PKM use case — retired. Free is a growth engine.
2. **Provider-agnostic credits** — users pick privacy/cost tradeoff; no single-vendor hard-wiring (retires Sarvam-first BYOK flow in `byok-settings.tsx`).
3. **Explicit regional pricing** — INR keeps existing users (₹499/mo Plus ≈ today's Pro price); USD captures global willingness-to-pay.

---

## 8. Open-Core Boundary & Plugin API

### 8.1 Boundary (drawn at the trust/perimeter line)

| Open (community) | Proprietary (hosted, paid) |
|---|---|
| Editor + Tiptap extensions | Managed cloud sync + relay |
| Local-first sync engine (Yjs/WAL) | Real-time collab server infra |
| PKM core: graph, backlinks, tags, search | AI router + credits ledger |
| Markdown import/export, provider registry | Team admin, SSO, billing |
| Plugin SDK + API | Publish hosting, managed OpenRouter path |

The line is where *running on our infra* begins. Everything on a user's device is open. The moat is the managed layer (Obsidian's sync model, plus collab + AI convenience).

### 8.2 Plugin API v1 (H1)
- Typed SDK over the graph: read/write pages, links, tags, properties — first-class data access, not DOM hacking.
- Extension points: sidebar panels, block-level extensions (Tiptap shape), slash commands, themes.
- **Sandboxed runtime** (Web Worker + iframe + postMessage) — a real improvement over Obsidian's unsandboxed community plugins.
- Validation criterion: *a plugin written by a stranger cannot exfiltrate the vault without consent.*
- Marketplace + themes in H2.

---

## 9. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Approach B delays global launch | Progressive migration keeps current app shippable; launch H0 scope disciplined |
| OpenRouter free models rate-limited/congested | Label free models clearly; rotate keys/endpoints; premium via paid credits; explore higher-limit free endpoints |
| Scope creep (Notion-parity expectations) | YAGNI guardrails: databases, block refs, plugins, SSO all explicitly deferred to H2 |
| Forking risk from open-core | Moat is managed sync + collab + AI convenience, not the editor |
| Free tier abuse | No bundled AI credits on Free; managed free path is rate-limited |

---

## 10. Out of Scope / Deferred
- Notion-style databases, block references, plugin marketplace, team SSO → H2.
- Desktop/mobile apps, publish, comments, plugins v1 → H1.
- Nothing from H0 ships unless it is global-ready (i18n, billing, provider registry).

## 11. Future Specs Required
- H0: schema migration + graph index service design; provider registry + OpenRouter integration design; billing/Stripe/Razorpay design; i18n framework design.
- H1: plugin API + sandboxing design; graph view UX; publish design; desktop/mobile app plan.
- Each spec → its own implementation plan (writing-plans).
