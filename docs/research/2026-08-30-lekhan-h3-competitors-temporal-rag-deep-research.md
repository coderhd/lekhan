# Lekhan H3 Deep Research: Competitors, Temporal RAG & Agent Compatibility

**Date:** 2026-08-30  
**Context:** H3 was office suite (Sheets/Slides/Mail/Chat as typed views over `pages.properties`), now pivoting to **NotebookLM-like Studio at graph root** (workspace-level RAG, studio artifacts) + **temporal RAG over `page_versions`** (git-style milestones) as v2 differentiator.  
**Stack ground truth:** Workspace → Pages (parent_id, properties JSONB, searchable_text) + page_links/page_tags/page_versions (Yjs per page, `y-websocket` relay, Tauri `.md` + `.lekhan/` sidecar, IndexedDB on mobile), Supabase + `pg_trgm` today (no `pgvector` yet), BYOK/BYOL via `provider-registry` (12 providers, AES-256-GCM vault, `TRUSTED_PROVIDER_BASE_URLS`, local `ollama|lmstudio`), AGPL+MIT open-core, one knowledge graph, many views.  
**Prior research:** `docs/research/2026-08-29-notebooklm-studio-lekhan-feasibility.md` (NotebookLM Studio teardown + achievable matrix) — this report is the competitive + temporal + agent companion.

---

## Executive Summary (TL;DR)

- **No competitor has Lekhan's exact wedge:** Obsidian is local-first but single-user/markdown-chaos; Notion is collaborative/structured but cloud-locked; AFFiNE is docs+whiteboard+DB but whiteboard-centric and young; Anytype is local-first+E2E+p2p but AI-weak and conceptual; open-notebook is BYOK RAG+podcast but notebook-silo, not a living graph. **Lekhan's "one graph, many views + local-first + collaborative + BYOK/BYOL" is still unoccupied.**
- **Studio pivot is validated but timing matters:** NotebookLM's Studio (audio/video/mind-map/reports/slides/infographic/quiz as formatter over grounded corpus) is the 2026 reference pattern. All competitors are converging on **workspace-level grounded generation + citations** (Notion Enterprise Search + Agents, AFFiNE AI, open-notebook Ask/Transformations). Lekhan's graph-root Studio (select by `tag`, `link`, `workspace_id`) is *more* powerful than NotebookLM's static-silo RAG because the graph *is* the corpus. Ship Group 1 (epics/briefing/table as new Pages) + Office (PPTX/XLSX) first — synthetic media (audio/slidecast) is BYOK-conditional.
- **Temporal RAG is a real v2 differentiator and Lekhan is structurally advantaged:** `page_versions` + tiered retention (Free 1d / Plus 90d / Pro 365d, `lib/tier-limits.ts`) already exists; no competitor does time-travel RAG over version history. Research is nascent (VersionRAG 90% vs 58% naive, TG-RAG bi-level temporal graph, rag-timetravel on LanceDB versioning) — Lekhan can be *first* to ship "as of 6 months ago" / "what changed" / "why did we change our mind" as product, not paper.
- **Agent compatibility: be an MCP *server first*, then a *client*, then A2A.** Competitors have already placed bets: Anytype ships `@anyproto/anytype-mcp`, AFFiNE ships first-party MCP (whiteboard-aware, free), Notion ships hosted `mcp.notion.com` + Custom Agents as MCP *consumers* with credits, Obsidian has no first-party MCP (community Local REST API only), open-notebook has REST API + MCP. Lekhan should expose its graph as MCP tools (the fastest path to "Lekhan-aware agents anywhere") before building an in-workspace agent runtime.

---

## 1. Competitor Matrix (August 2026, live pricing)

| Dimension | **AFFiNE** | **Anytype** | **Obsidian** | **Notion** | **open-notebook (lfnovo)** | **Lekhan (target)** |
|---|---|---|---|---|---|---|
| **Positioning** | Open-source Notion+Miro: docs + edgeless canvas + DB in one file | E2E encrypted, local-first Notion alternative; objects/types/relations | Local-first markdown files you own; graph + Canvas + Bases | Cloud all-in-one workspace (docs/wikis/DBs/Mail/Calendar/Meetings) | Self-hosted NotebookLM: privacy + flexibility, podcast-first | Local-first like Obsidian + collaborative like Notion + AI on user's keys |
| **Local-first** | **Yes** — local-first + offline, self-host Docker free; E2E on sync (Time Machine versions) | **Yes — strongest** — on-device encryption, p2p sync on local net, offline-first, no server gatekeeper; even account creation offline | **Yes — canonical** — vault = folder of `.md`, fully offline, git-friendly | **No** — cloud-first; offline mode only arrived Nov 2025 (3.1), still limited | **Yes** — self-host via Docker Compose, fully offline with Ollama/LM Studio; no cloud dep | **Yes** — per-page Yjs + `IndexedDB`/`sidecar WAL`, offline queue + CRDT merge via hub relay |
| **Collaboration** | Real-time collab on Cloud tier; shared workspaces; self-host team | Shared spaces: Free ≤3 members, Builder 10 editors, Co-Creator unlimited; p2p/shared spaces maturing | **Weak natively** — Sync shared vaults = async + merge conflicts; true live = plugins (Relay/Peerdraft CRDT, live cursors) — now "credible" in 2026 | **Strongest** — real-time multiplayer, permissions, Teamspaces, guests, SSO/SCIM | **Not yet** — single-user today; `[Umbrella] Multi-user System Support #712` open (Apr 2026) | **Native** — Yjs + `y-websocket` + `page_members` (owner/editor/viewer), `workspaces.is_team` scaffolded |
| **Graph** | Page ↔ Edgeless canvas dual mode; database blocks; whiteboard search; page linking inside docs | Objects + relations + Types + Sets/Collections; graph view (can be overwhelming); backlinks via relations | **Best** — `[[wikilink]]` bidirectional + interactive graph view + local graph + filtering; Canvas; **Bases** (2026) = native table/board/list over YAML properties with formulas | Page hierarchy + databases (tables/boards/calendar/gallery) + relations/rollups; no native graph view (key gap) | Notebook → Sources (doc/vector) → Insights graph; SurrealDB graph edges (`notebook↔source↔embedding`) but **notebook-isolated silo** (no cross-notebook retrieval yet, roadmap) | **One graph** — `pages` + `page_links`/`page_tags`/`properties JSONB` indexed incrementally (`server/graph-index.js` transactional, `sync_page_graph`) + `searchable_text` trigram; graph view (`#38`) feeds Databases (`#47`) |
| **Agents / AI** | Integrated AI assistant (draft, summary, mind-map, slides, whiteboard-aware) — built-in, AI must be enabled for MCP self-host | Limited — no built-in AI (choose other if AI matters); community asks; future | **No native AI** (explicit team choice to keep core local/private); via plugins: Smart Connections, Copilot, Text Generator — all BYOK (OpenAI/Anthropic/Ollama local) | **Most mature 2026** — Notion AI: writing, Enterprise Search (Notion+Slack/GitHub/Jira/etc), Meeting Notes, Autofill, 20-min autonomous **Notion Agent**, **Custom Agents** (trigger/schedule, 24/7, $ credits), **Workers** deterministic | Multi-model 18+ providers (OpenAI, Anthropic, Ollama, LM Studio, DeepSeek, xAI, Voyage, …) via **Esperanto** abstraction; reasoning models (R1, Qwen3); fine-grained context control | **BYOK/BYOL only** — `provider-registry` 12 providers, vault-encrypted keys, local direct `ollama|lmstudio`, `ai/client` router with fallback; cost safety = $0 to Lekhan |
| **Studio-like features** | AI: doc → slides, mind-map, summaries, databases; Time Machine versions; edgeless templates | Templates + database views (table/kanban/gallery) as "Studio views"; no synthetic media | Bases = no-code DB views over properties (table/card/list, filter `status="reading"`); Canvas; community AI plugins generate summaries/tables | **Closest to NotebookLM Studio** — Research Mode, dynamic reports, slide decks, dashboards, presentation mode, podcasts via integrations; 3.0-3.4 shipped charts/XLSX/PPTX factory | **NotebookLM feature parity:** multi-speaker podcast (1-4 speakers, Episode Profiles) with async job queue (`surreal-commands`), content transformations (summarize/extract), vector+FTS search, citations, comprehensive REST API, artifacts | **Planned:** G1 graph-native (epics/stories/briefing/table→new Pages with `properties`+`[[links]]`), L1/L2 quiz/flashcards, O1/O2/O3 PPTX/XLSX/DOCX (pptxgenjs/exceljs reuse), S1 audio via BYOK TTS + job queue — from feasibility report |
| **Team workspaces** | Cloud Cooperation + Team hub + Enterprise private cloud/self-host | Spaces + Members + membership tiers; paid network storage | Teams via commercial license + Sync/Publish for shared vaults; Deploy guide; enterprise via license only (AGPL-not-relevant — Obsidian core is proprietary, plugins open) | Teamspaces, admin, SSO/SCIM, guest sharing, per-seat billing, private teamspaces (Business+), Enterprise governance | None yet (multi-user umbrella) | **Scaffolded:** `workspaces.is_team` false default + `UNIQUE(owner_id)` (one personal workspace in H0), `page_members` roles; Team (#49) rides `#29` billing |
| **Pricing (annualized, Aug 2026 verified)** | **Free** unlimited local + 10 GB cloud; **Pro $6.75/mo**; **Team $10/seat/mo**; **Self-host free** (MIT open-source) | **Free** (1 GB sync, 3 members) · **Builder $9/mo ($99/yr, 128 GB, 10 editors)** · **Co-Creator $19/mo (1 TB, multiplayer)** — sources vary ($4–$10 legacy) due to beta→paid transition | **Free** core (even commercial, no license required); **Sync $4/mo annual ($5 monthly, $60/yr)**; **Publish $8/site/mo annual ($10 monthly, $120/yr)**; **Commercial $50/user/yr** optional patronage | **Free $0** (limited AI) · **Plus $10/user/mo** ($12 mo) · **Business $20/user/mo** ($24 mo, full AI incl.) · **Enterprise custom** + **Custom Agents $10/1k credits** (May 4 2026+) | **Free** self-host (pay only AI provider usage) — 32.5k stars, 3.7k forks; AGPL-style open-source | **Planned** (`docs/superpowers/specs/...` §7): Free $0 (unlimited local, 2 editors/page, 7d history) · **Plus $6/mo (₹499)** · **Pro $12/mo (₹999)** · **Team $10/seat/mo (₹799, 2-150 seats)** — per-workspace, never per-AI-credit |
| **Product structure** | **Monolith with dual view:** Page ↔ Edgeless *same* content (one file, two modes) + DB blocks — unified, not modules | **Monolith with type system:** objects + types/relations (deep-module vocabulary) | **Monolith core + 2,700+ plugins:** core stays small, capabilities via plugins (Dataview, Templater, Calendar, Kanban, Excalidraw…) | **Monolith workspace:** docs+DBs+projects+wiks+mail+cal+meetings+agents in one canvas; + **Developer Platform + MCP connectors** (Box, ClickHouse, Mercury, Miro, Mixpanel) | **Three-tier:** Next.js (8502) ↔ FastAPI (5055) ↔ SurrealDB (8000, graph + vector); LangGraph workflows (ask/chat/transform); job queue for podcasts | **Deep modules:** Workspace → Pages graph (substrate) → views (editor/search/graph/Bases-like DBs) → Suite (Sheets/Slides/Mail/Chat as typed views over `properties`) — architect-now, progressive migration |

*Sources:* AFFiNE site/pricing pages + toolradar/aisotools sync checks (Aug 2026); Anytype pricing (anytype.io + checkthat/toolradar July-Aug 2026); Obsidian skiln/productivitybrief/obsidian.md pricing April-Aug 2026; Notion pricing + 3.0-3.4 release notes (Feb-Apr 2026) + per-credit Custom Agents May 2026; open-notebook GitHub README + DeepWiki architecture + issues #372/#712 (July 2026).

### Product Structure Lens: Monolith vs Modules — what it means for Lekhan

- **Monolith (Notion, Obsidian core, AFFiNE page/edgeless):** One workspace/app that keeps adding views. Moat = network effect + content lock-in. Risk = bundle bloat, paywall creep.
- **Deep modules (Anytype types/relations, open-notebook tiers):** Type system or service boundary defines seams. Anytype's `objects → types → relations → sets` is the cleanest deep-module vocabulary in the set.
- **Lekhan's bet (deep modules by design):** The approved substrate (§ Strategy §3) is explicit — `pages` graph is substrate, *every* later capability (Databases `#47`, Sheets `#52`, Slides `#53`, Mail `#54`, Chat `#55`, Studio) is a *view* over it. This matches AFFiNE's "one file, two modes" intuition but generalizes: **one graph, many views** (editor, search, graph, table/board/calendar/gallery, sheets, slides, threads, artifacts). The discipline is to enforce deep-module boundaries (`types.ts` before parallel worktrees, `using-git-worktrees` protocol) — Anytype does this via type system; Lekhan should do it via `properties` schemas + typed views.

---

## 2. Competitor Deep Dives — Right Now (July-Aug 2026)

### 2.1 AFFiNE — docs + whiteboard + DB, local-first, open-source

**What they're doing right now:**
- Open-source (MIT) alternative to Notion+Miro. Every doc is also a canvas — instant toggle between linear Page view and spatial Edgeless view for *same* content (no export to separate app). Database blocks, rich media, embeddable content, markdown support, page linking, rich blocks.
- Local-first storage + sync, offline-capable, Docker self-host free, free cloud tier for hosted sync + real-time collaboration (Cloud Cooperation, Cloud Drive, Cloud Time Machine version restore anywhere).
- Integrated AI assistant (drafting/brainstorming, mind maps, slides) — AI features must be enabled when self-hosting (so MCP also gated). Whiteboard text is indexed (Edgeless search with element/frame locators) — unique vs Notion/Obsidian.
- Builds everything in public (`toeverything/AFFiNE` open issues), community on Discord, enterprise private cloud.

**Structure:** Monolith with dual-mode document as primitive. Not separate apps for docs/whiteboard — one data model, two render modes.

**Pricing:** `Free forever` (10 GB cloud), `Pro $6.75/mo`, `Team $10/seat` + self-host free. (Schema snippet on affine.pro pricing confirms this tierset as of July 7, 2026: `Free for individuals, commercial and team usage fees apply — Free, $$$, $$$` + JSON-LD `Free forever, Pro $6.75/mo, Team $10/seat, plus self-host`.)

**Agents & MCP:** First-party **AFFiNE MCP server** (`affine.pro/mcp`): stdio default or HTTP `/mcp`, supports AFFiNE Cloud + self-host, tools for workspaces/documents/whiteboards/databases; whiteboard search vs Notion (none) vs Obsidian (canvas as raw JSON). Free on cloud/self-host with AI enabled. Also community `DAWNCR0W/affine-mcp-server`.

**Learn from:** The Page ↔ Edgeless *single-file dual view* is the best physical instantiation of "one graph, many views" — Lekhan's Sheets/Slides should steal this interaction: same `page.properties` rendered as doc *or* grid *or* deck without conversion. And AFFiNE's whiteboard-aware MCP proves that indexing spatial content (canvas elements, not just markdown) unlocks agent use cases that text-only competitors miss.

**Do NOT copy:** The open-source + cloud hybrid monetization is still fragile — AFFiNE leans on MIT + hosted upsell but has not yet nailed team workspace RBAC/SSO story versus Notion's enterprise surface. Don't copy the "every feature inside one file" coupling for version history — AFFiNE Time Machine is per-document snapshots, not graph-aware. Lekhan should avoid flattening version history into per-page snapshots without page_links/properties evolution — temporal RAG needs graph-level versioning.

### 2.2 Anytype — E2E encrypted, p2p, object/relation type system

**What they're doing right now:**
- Tagline "A safe haven for digital collaboration" — local-first, on-device encryption (only user has keys), never lose access, offline account creation, p2p sync on local networks, no server gatekeeper, open protocols (`anyproto`), self-host backups where you please. "Nobody is mediating the connection between your devices."
- Building blocks: block-based editor, Databases (table/kanban/gallery), Templates, Widgets (dashboards), Graph + database views over same objects. Objects are single substrate with infinite possibilities via Types/Relations. Think "single objects, infinite possibilities — visualise connections using graph & database views."
- Native on mobile (iOS/Android), offline-first ("your vault lives on your device, no server means no lag"), fast sync, cross-platform.
- Tech: E2E encryption, open source (open protocols), no-code creation. 100 MB free network storage up to 100 GB Ultra in older docs; newer 2026 pricing shows `Free: 1 GB sync, unlimited objects, E2E, self-host | Builder $9/mo 128 GB | Co-Creator $19/mo 1 TB multiplayer` — small-team collaboration is maturing but still limited (shared spaces 3 members free).

**Pricing evolution (note the variance — reflects beta → paid transition):**
- Older checkthat.ai snapshot (July 2026): Free $0 (100 MB) → Builder/Coop $4-$16, plus legacy aitoolpick listing Free/Builder $10/Coop $14.
- Current toolradar verify (Aug 2026): Free 1 GB · Builder $9/mo ($99/yr) · Co-Creator $19/mo.
- Implication: Anytype monetizes **remote backup & sync/storage**, not the app itself — local-only/P2P remains $0 forever. This is the closest to Lekhan's "never-host AI cost" discipline.

**Agents & MCP:** Ships `@anyproto/anytype-mcp` — converts Anytype's OpenAPI spec into MCP tools, global & space search, spaces & members management, via `npx -y @anyproto/anytype-mcp` with `OPENAPI_MCP_HEADERS: {Authorization: "Bearer <API_KEY>", Anytype-Version: "2025-05-20"}`; one-click for Claude Desktop/Cursor/Windsurf/Raycast + `claude mcp add` + global install. Also `anytype-cli` headless server for automation.

**Learn from:** Anytype's **type system** (objects → types → relations → sets/collections) is the only competitor that built a *domain model* deep-module vocabulary before scaling views — Lekhan's `properties JSONB` needs exactly this: declare `properties` schemas (epic: `{status, priority, estimate}`, reading-list: `{venue, year, keyFinding}`) as typed views, with validation + relation semantics (`[[link]]` as typed relation, not just string). Also steal Anytype's pricing honesty — storage/sync-based, not surveillance/data-based — aligns with Lekhan's per-workspace + per-seat, not per-token.

**Do NOT copy:** Anytype's **AI weakness is structural** — local-first + E2E trades away server AI; they have no meaningful Studio/synthetic media story, and their graph view "can become overwhelming" without retrieval. Don't copy p2p-only sync dogma for Studio — Lekhan's hub-relayed Yjs is the right call for permission-aware vector search (Anytype can't do server RAG over encrypted vaults without client-side indexes, same as Lekhan's E2E caveat). And don't copy the steeper onboarding (objects/types paradigm requires learning investment vs Notion's page-first) — Lekhan's `[[wikilink]]` + `#tag` + typed-view progressive disclosure is simpler.

### 2.3 Obsidian — local markdown, graph, Bases, plugin universe, no native AI/collab

**What they're doing right now (April-Aug 2026):**
- Local folder of `.md` files ("vault") — every note is plain text, no DB, no proprietary format, survives if Obsidian disappears. Bidirectional `[[links]]` + interactive graph (filtered by tag/folder/search) + Canvas infinite whiteboard + 2,700+ community plugins (April 2026) + 200+ themes.
- **Bases (early 2026, core plugin, no install):** native no-code database views over YAML `properties` already in notes — Table/Card/List views, filter (`status="reading"`), sort, formulas; stored as `.base` files. Reads existing frontmatter, shows as database. Comparison: Notion DB = proprietary cloud; Bases = your machine, local, free, instant, but frontmatter-only (no Dataview inline fields), weaker computed output, no two-way relational schema with rollups — still maturing (right-click/drag-drop/copy-paste landed March-June 2026).
- **Mobile 2.0** (v1.11 Jan 2026): lock-screen/Control-Center widgets, Siri/Shortcuts, share sheet ("save content from any app into vault").
- **CLI Tool** (v1.12 Feb 2026): scriptable vault ops, image resize, attachment cleanup, dev workflows.
- **Collaboration:** Native Sync shared vaults = async with merge-conflict resolution (not real-time); true live via plugins **Relay** (free forever $0/3 users/2 devices, Hobby $5/total, Starter $6/user/mo + self-host) and **Peerdraft** (E2E encrypted ad-hoc + persistent shares, no account for join) — CRDT + live cursors, but not as polished as Notion. Forum request "Live team collaborative editing" (2020) still open; tech-internal 2026 review: "Can work for small, technical teams … but Notion's native multiplayer + lower friction wins for most orgs."
- **AI stance (explicit):** "Not natively. Team avoided baking in AI to keep core local/private." Add via plugins: **Smart Connections, Copilot, Text Generator — all BYOK** to OpenAI/Anthropic/local Ollama. Performance at scale is a selling point (local files beat cloud DB latency as vaults grow).
- Business: never taken VC, revenue = Sync + Publish only; now **free for everyone including commercial use** (2025 change — commercial license $50/user/yr is now *optional patronage* to support independent, 100% user-supported).
- Also: MCP via plugins (see §4), Bases Copy/paste, local-first + offline + zero telemetry.

**Pricing (July-Aug 2026):**
| Tier | Price | Notes |
|---|---|---|
| Personal (Free) | $0 | Unlimited notes, no signup, full core |
| Sync | $4/mo annual ($60/yr) or $5/mo monthly | E2E encrypted, version history, shared vaults, priority support |
| Publish | $8/site/mo annual ($120/yr) or $10 monthly | Public website from notes, custom domain |
| Catalyst | Patron one-time | Early beta, badges |
| Commercial | $50/user/yr | *Optional* — "You are not required to pay for a commercial license" |

**Structure:** Small proprietary core + massive **unsandboxed** community plugin runtime (success = 2,700 plugins; risk = exfiltration capable). Capability model is host-in-process, not sandboxed Worker.

**Learn from:** Bases is the **existence proof** that a local file store + `properties` can grow into Notion-like structured views without abandoning markdown — Lekhan's `properties JSONB` is the same substrate, and Bases' `.base` file = a persisted view spec is exactly the artifact to clone (persist Studio-generated tables as typed views, not exports). Obsidian's "links are the structure; tags/folders sweep the floor" is the right graph-first editorial. Also steal Obsidian's honest "plugin chaos but true ownership" contract — Lekhan's sandboxed plugin API (Web Worker + iframe + postMessage, per ADRs §8) is the improvement; sell the sandbox as *feature* vs Obsidian's unsandboxed risk.

**Do NOT copy:** (1) **No native collaboration** is existential — Obsidian loses every team evaluation despite graph/Bases wins; Lekhan must not under-invest in `#49` Team workspaces + multiplayer cursors (Yjs already there). (2) **Plugin security + discoverability tax** — unsandboxed plugins can exfiltrate vault, and "plugin marketplace with 2,700 entries, 12 must-install to be productive" is the anti-pattern Lekhan's sandbox + analyzer (`capability declaration matches actual API usage`) is designed to fix. (3) **Markdown purism vs rich blocks** — Obsidian's `block_id` reserved NULL in H0, canvas as JSON sidecar, inline fields vs frontmatter schism. Lekhan should define typed blocks (`icon, cover, properties`) up front.

### 2.4 Notion — cloud all-in-one + AI workspace + agents + MCP connectors

**What they're doing right now (2026 is the inflection year):**
- Workspace replaces Google Docs + Trello/Asana + Confluence + Airtable + meeting transcription + email/calendar. Single canvas: notes, documents, databases, project management, wikis, plus now **Mail, Calendar, Meeting Notes**.
- **Notion 3.0 (Sep 2025):** AI Agents (20+ min autonomous multi-step across hundreds of pages), Enterprise Search, Notion Mail, MCP integrations.
- **Notion 3.1 (Nov 2025):** Offline mode, database permissions, automations.
- **Notion 3.2 (Jan 2026):** Mobile AI Agents, model picker (GPT-5.2, Claude Opus 4.5, Gemini 3), people directory.
- **Notion 3.3 (Feb 2026):** **Custom Agents** — autonomous AI teammates running 24/7 on trigger/schedule across Notion + Slack + Mail + Calendar + Figma + Linear + MCP. Use cases: task triage, internal Q&A, daily standups, inbox zero. Ramp case: 20 hrs/week saved triaging Slack.
- **Notion 3.4 (Mar-Apr 2026):** Dashboard views, presentation mode, AI image generation, redesigned sidebar, GPT-5.4, Custom Skills, Desktop revisions.
- **AI details (2026 reality):** Notion AI = not a sidebar chatbot but workspace system: writing (rewrite/summarize/brainstorm/translate), **Enterprise Search** (live search across Notion + connected tools: Slack, Teams, GitHub, Jira, Box, OneDrive, Salesforce, Asana — Beta for latter), **Research Mode** (internal reports synthesis), **AI Meeting Notes** (transcripts/decisions/action items), **Database enrichment** (AI Autofill, classify), **Notion Agents** (20-min autonomous tasks). Best results come from *structured databases, clean ownership, narrow agent instructions* — Notion's own moat is docs+DBs+permissions as one canvas.
- **Developer Platform (May 13 2026, 3.5):** plus **MCP connectors** — June 2026 added Box, ClickHouse, Mercury, Miro, Mixpanel for Custom Agents (agents pull data/execute tasks across tool stack, e.g., Mixpanel → Box report, Mercury transactions → Notion DB). Previously Figma, Linear etc. Agents orchestrate across entire software stack, not just Notion.
- Also: database permissions, presentation mode (competing with Slides), image generation.

**Pricing (May 2026 live):**
| Plan | Price (annual) | AI | Best for |
|---|---|---|---|
| Free | $0 | Limited trial only | Solo, basic blocks |
| Plus | $10/user/mo ($12 monthly) | Limited trial only | Small teams without AI |
| Business | $20/user/mo ($24 monthly) | **Full Notion AI** (Agent, search, Meeting Notes, Enterprise Search) + agents + connectors | Teams wanting AI |
| Enterprise | Custom | Full AI + zero data retention + SCIM/DLP/audit | Regulated, large orgs |
| **Change** | Standalone **$10 add-on retired May 2025** (grandfathered only). **Custom Agents** free through May 3 2026, then **$10 per 1,000 Notion credits** pooled/month (reset, no rollover). Core AI (Agent, writing, autofill, search) stays included; only Custom Agents burn credits (simple run = fraction of credit, long run = dozens). Apr 2026: Custom Agents 35-50% cheaper, small models 10× fewer credits.

**Agents & MCP:**
- **MCP Server:** Official hosted `https://mcp.notion.com/mcp` (OAuth, remote, also via `npx mcp-remote`). Notion API `2025-09-03`. Tools: pages, databases, blocks, users, comments, search — 4 tool families via mcp-agent, also via Airbyte SDK (`build_connector_tools` for openai_agents/mcp) and Scalekit proxy (one-click MCP path). Standard `mcp-remote` install.
- **MCP Clients:** Custom Agents are MCP *clients* — they consume external MCP servers (Box etc). So Notion is **both server (expose workspace) and client (agents reach outside)**. This is the 2026 pattern Microsoft Build ratified: MCP = default integration layer across Foundry/Agent 365/IQ/Copilot (970× growth to 97M monthly downloads Mar 2026).

**Structure:** Monolith workspace + **Developer Platform** + **MCP federation** for external tools. Notion is building an *agent OS* (Notion as AI workspace: "Build and orchestrate agents right alongside your team's projects, meetings, and connected apps").

**Learn from:** Two things Lekhan should clone immediately:
1. **Agents as narrow workflow services, not digital employees** — Perplexity/Notion testing: "The best agent is not 'do operations.' It's 'watch this intake database, classify requests by policy, assign owners from this table and post exceptions for review.' Precision beats personality." Lekhan's Studio agents should ship as constrained templates (e.g., "Generate 8 epics from pages tagged `inbox` linking to [[Roadmap]]") not open-ended co-pilots.
2. **Enterprise Search across connected tools as moat** — Notion's moat is *not* model quality, it's docs+DBs+permissions+connectors in one canvas. Lekhan's graph-root Studio should treat connectors as *import pipeline* wins (Notion/Obsidian import IR already scoped, plus future MCP ingestion) — "your data stays, the tool changes" is the SEO wedge.

**Do NOT copy:** (1) **Pricing entanglement + credits opacity** — Notion eliminated the cheap AI add-on, now requires $20/seat Business for full AI, plus *separate* credits for Custom Agents (e.g., 10-person team + 2 daily agents = $200/mo base + $20-50 credits + risk of hundreds if heavy). Verdict: "No easy way out for solo writers who only wanted AI." Lekhan's "every tier BYOK/BYOL, no bundled credits, never Lekhan's line item" (Strategy §6.3) is cheaper *and* more honest — don't add credits. (2) **Messy workspace → AI amplifies disorder** — Notion's own review warns: "If a workspace is messy, duplicated or poorly permissioned, AI can amplify that disorder" and "poorly scoped autonomy" fails. Lekhan should enforce permission-aware retrieval *by construction* (`SECURITY INVOKER` + `can_access_page`) and graph filters to keep agents narrow, not add Notion-style sprawl.

### 2.5 open-notebook (lfnovo/open-notebook) — the closest Studio analog, and the furthest graph analog

**What they're doing right now (June-Aug 2026):**
- **Stats:** 32.5k stars, 3.7k forks (June 2026), Python + FastAPI + Next.js + SurrealDB + LangChain stack. Surveyed by agents-radar June 5 2026 as one of hottest "Agent Orchestration UIs" alongside Cherry Studio.
- **Pitch vs NotebookLM:**
  | Dimension | open-notebook | NotebookLM (Google) | Advantage |
  |---|---|---|---|
  | Privacy | Self-hosted, your data | Google cloud only | Sovereignty |
  | AI choice | **18+ providers** (OpenAI, Anthropic, Google, Ollama, LM Studio, Mistral, DeepSeek, xAI, Cohere, Voyage, OpenRouter, DashScope/Qwen, MiniMax, …) via **Esperanto** abstraction + OpenAI-compatible custom | Google models only | Flexibility + cost |
  | Podcast | **1-4 speakers**, Episode Profiles, advanced diarization | 2 speakers only | Multi-person |
  | Deployment | Docker / cloud / fully local | Google-hosted only | BYOL |
  | API | **Comprehensive REST API** (`:5055/docs`) | None | Programmatic |
  | Cost | Pay only AI usage | Google subscription | Pay-per-use |

- **Core capabilities:** Multi-notebook org (manage multiple research projects), universal content ingestion (PDF/DOCX/TXT/CSV/PNG/JPG/GIF/MP3/MP4/WAV/JPG + YouTube + web + EPUB + MP3 transcription + Google Docs/Sheets/Slides via Deep Research → curated sources), 18+ provider LLM + embedding + STT/TTS via Esperanto, reasoning models (DeepSeek-R1/Qwen3), professional podcast generation (async job queue via `surreal-commands`), full-text + vector search sur hybrid, context-aware chat (RAG grounding), AI-assisted notes, content transformations (customizable summarize/extract), fine-grained context control (choose what to share), citations, optional password auth, multi-language UI (EN/PT/ZH/JA/RU/BN), local inference (oMLX for Apple Silicon).
- **Architecture (three-tier):**
  ```
  Frontend :8502 (Next.js 15 + React 19 + Zustand + TanStack Query + Tailwind/Shadcn)
         ↕ proxies /api/*
  API      :5055 (FastAPI async + Pydantic v2 + Loguru + Pytest, LangGraph workflows)
         ↕ SurrealQL async
  DB       :8000 (SurrealDB — multi-model doc+graph+vector, ACID, graph-first future, real-time subscriptions)
  ```
  Tables: `notebook`, `source` (full_text, topics, asset), `source_embedding` (chunk_text, chunk_index, embedding), `note`, `chat_session`, `transformation`, `source_insight`, relations `reference` (source→notebook), `artifact` (note→notebook). Vector + FT search on `source.full_text`/`note.content`, cosine similarity. Migration auto-run on startup, soft-deletes (`archived`), ISO timestamps.

- **LangGraph workflows:** `ask.py` (Plan Search → Vector+Text search → Score/Rank → Synthesize → Stream), `chat.py` (context via `build_context_for_chat` with token counting), podcast async via SurrealDB job queue.

- **Roadmap (2026 open issues):** Live front-end updates, async processing, **cross-notebook sources** (reuse materials across projects — currently isolated silos like NotebookLM), bookmark integration; recently completed: Next.js frontend, REST API, multi-model, advanced podcast. Multi-user support (`#712` umbrella) and SurrealDB architecture decision (`#372` — native graph+vector, ML-friendly queries, frontend-accessible like Firebase/Supabase) are active umbrellas.

- **Docs/UX:** 2025-07-29 blog teardown notes: adaptive chunking (large context 1-2M tokens → inject full docs for small/medium notebooks, semantic chunking only for large; hybrid with Gemini embeddings + HNSW), enhanced retrieval & ranking.

**Pricing/model:** Free (AGPL) self-host (Docker Compose); cost = your provider keys (same as Lekhan BYOK). No SaaS gatekeeping.

**Agents & API:** Comprehensive REST API + MCP integration for Claude Desktop/VS Code. Esperanto enables provider-level override per request + automatic fallback. Job queue enables async long-run (podcast) without timeout.

**Learn from:** Two things Lekhan must internalize:
1. **The Esperanto pattern** — normalizing 18+ provider auth/streaming/error/capability into one interface is exactly the `provider-registry` discipline Lekhan already has (`lib/ai/provider-registry.ts`, `ai/catalog.ts`, `ai/client.ts` with `TRUSTED_PROVIDER_BASE_URLS` + local direct). Open-notebook proves per-request provider override + fallback is table stakes for Studio (embeddings must be swappable Gemini ↔ Ollama `nomic-embed-text` ↔ local `all-MiniLM` per E2E/workspace setting).
2. **Async job queue + citations as product, not demo** — open-notebook's podcast runs as background SurrealDB job (not in-prompt), with fine-grained context control + citations per claim. Lekhan's `studio_jobs` table + `studio_artifacts` bucket from feasibility report mirrors this — do it exactly.

**Do NOT copy:** (1) **Notebook-isolated silos** — open-notebook's `notebook` = NotebookLM's Notebook = one corpus per project, no cross-notebook retrieval. This is the *antithesis* of Lekhan's "one knowledge graph, many views" workspace-root Studio. Don't ever reintroduce per-folder/per-notebook silos; Lekhan's wedge is *workspace-level* RAG over the whole graph (filtered by `tag`/`link`/`workspace_id`), not silo-level. (2) **SurrealDB + graph that is not a PKM graph** — SurrealDB is a good multi-model pick for *their* podcast pipeline, but Lekhan's graph is already Postgres (Supabase, `pg_trgm` → `pgvector`, RLS, edge functions, storage). Don't migrate DBs; add `page_chunks` + HNSW onto Supabase — the hybrid-search recipe is proven and preserves RLS + offline story. And don't copy open-notebook's lack of multi-user — Lekhan's collaborative Yjs + `page_members` is ahead; keep it.

---

## 3. Temporal RAG — Tool Survey: Is Anyone Doing Version-History Retrieval?

### 3.1 The Short Answer

**No shipped product does temporal RAG over *page version history* as a first-class query type ("why did we change our mind?", "what did we believe 6 months ago?", "show me the evolution of [[Pricing]]").** Research prototypes and a handful of libraries cover *fragments* of the problem (document versioning, time-aware retrieval, audit trails), but none combine:
- per-page `page_versions` retention,
- graph-aware retrieval (`page_links`/`page_tags`/`properties` evolution),
- workspace-level permission-filtered RAG,
- time-travel UX (as-of / between / diff queries) —
as Lekhan could.

This is a **first-mover window**.

### 3.2 Taxonomy: What "Temporal" Means in Current Systems

| Temporal type | Question shape | System that addresses it | Lekhan analog |
|---|---|---|---|
| **Valid-time document versioning** | "What does the doc say *at* v15.14.0?" | **VersionRAG** (ZHAW, Oct 2025) — hierarchical graph of version sequences, content boundaries, changes | `page_versions` + `page_chunks` with `version_id`/`created_at` + `page_id` graph |
| **Transaction-time / audit** | "Reconstruct the *exact* index as of 2024-08-19 for compliance" | **LanceDB versioning + rag-timetravel** — pin retrieval to LanceDB dataset version integer (O(1) checkout) | Supabase `page_chunks` with `updated_at` + `page_versions` metadata or chunk-level `valid_from/until` |
| **Temporal knowledge-graph evolution** | "Summarize trends in [[Pricing]] over H1 2026" | **TG-RAG (Temporal GraphRAG)** — bi-level temporal graph (timestamped relations + hierarchical time summaries) | `page_links` temporal graph + time summaries over `page_versions` diffs |
| **Post-retrieval temporal boosting** | "Stale answers must not surface (rate limits, deprecated endpoints)" | **Emmimal/temporal-rag**, **Lyzr Cognis**, **Chatnexus delta+snapshot** | Recency + change-aware reranker over `page_versions` |
| **Memory with version history** | "We changed the API contract — don't answer from 2024" | **Cognis**, **Mem0/Zep/SuperMemory** | Hybrid BM25+vector+temporal intent → RRF fusion |

### 3.3 Survey Table: Tools, Papers & Libraries

| Name | Maturity | What it does | How it retrieves temporally | Storage | Key result | Link |
|---|---|---|---|---|---|---|
| **VersionRAG** (Huwiler et al., ZHAW, Oct 2025) | Paper + benchmark (**VersionQA** 100 Qs, 34 versioned docs) | *First* RAG for versioned documents — hierarchical graph captures version sequences, content boundaries, change nodes; query classifier routes to specialized paths | Intent classification → **version-aware filtering + change tracking** via graph traversal; hybrid retrieval | Graph DB (hierarchical) | **90% accuracy** vs 58% naive RAG / 64% GraphRAG; **60% on implicit change detection where baselines 0-10%**; 97% fewer tokens than GraphRAG; 100% on version-specific content (vs 55% naive) | `arxiv.org/abs/2510.08109` |
| **TG-RAG / Temporal GraphRAG** (Oct 2025) | Paper + dataset **ECT-QA** (earnings-call transcripts across time) | Models corpus as **bi-level temporal graph**: temporal knowledge graph (timestamped quadruples s,p,o,t) + hierarchical time graph + multi-granularity summaries | **Local retrieval** (fine-grained facts within time window) + **Global retrieval** (temporal summaries for trends/events); incremental updates supported | Graph + time summaries | F1 0.648 NQ, 0.719 2Wiki, 0.757 Hotpot even outside temporal; effective update cost + retrieval stability | `arxiv.org/abs/2510.13590` |
| **rag-timetravel** (Ar-maan05, MIT, PyPI 2026-06-30) | OSS lib, LanceDB-native | **Time-travel debugging for RAG retrieval layer** — every retrieval/generation is immutable event; vector index versioned automatically; re-run retrieval against historical index, diff then vs now | **LanceDB dataset versioning:** every write = new version integer; snapshot = pointer to version; checkout past = `O(1)` no copy; retrieval replay is faithful (tested) | LanceDB (columnar) + SQLite event store (swap to Postgres later) | Retrieval diff is deterministic; generation replay is best-effort; fills gap traces (Langfuse/Arize/LangSmith/TruLens) cannot — they treat index as opaque | `github.com/Ar-maan05/rag-timetravel` · `pypi.org/project/rag-timetravel` · `docs.lancedb.com/tutorials/agents/time-travel-rag` |
| **LanceDB Time-Travel RAG tutorial** | Docs + recipe | Financial regulatory KB (Federal Register) versioned ingestion (500 docs iterate, 86→188→302 rows, versions 1→3) | `checkout(version)` → rerun query; date-based audit + A/B embedding model comparison | LanceDB | Tutorial for audit trails, compliance | `docs.lancedb.com/tutorials/agents/time-travel-rag` |
| **Emmimal/temporal-rag** | OSS, post-retrieval library (Apr 2026) | Post-retrieval **time-aware reranking** — temporal layer surfaces freshest/most relevant, handles implicit expiration, conflicting sources delegated to LLM | Adds temporal boosting to any retriever; rule-based heuristics by content type for expiration | Pluggable retriever | "Worth it when you update regularly / stale has consequences / multi-version docs must not conflate; skip when corpus static" — directly maps to Lekhan | `github.com/Emmimal/temporal-rag` |
| **danielhuwiler/versionrag** | OSS companion to paper | Versioned Document RAG implementation | Version-aware graph + metadata filtering | — | "Maintain temporal alignment, version specificity" vs standard/GraphRAG | `github.com/danielhuwiler/versionrag` |
| **Chatnexus Version-Controlled RAG pattern** | Managed platform docs (Sep 2025) | Production pattern for evolving knowledge bases (legal/engineering/marketing) | **Delta + Snapshot hybrid:** real-time deltas (2s/10s debounced) + daily snapshots; **version metadata per embedding** (`document_id`, `version`, `embedding`, …); **time-travel API** (`as-of`, `between versions`, `current`); **partitioned indexes per snapshot** vs **unified index with metadata filters** (Pinecone/Weaviate metadata filtering) | Vector DB metadata filtering + webhook/FS CDC | Describes governance (access logs, change logs, versioned RBAC), retention policies, As-Of Recall@K benchmark | `articles.chatnexus.io/knowledge-base/version-controlled-rag-managing-document-updates-and-history/` |
| **Lyzr Cognis** (Mar 2026, arXiv 2604.19771) | Paper + memory system | Context-aware memory for conversational agents — 15-category taxonomy, Matryoshka embeddings, hybrid retrieval, version history + temporal reasoning | **Hybrid retrieval (BM25 + vector) → RRF fusion → temporal intent detection → time-window scoring → BGE-2 cross-encoder rerank**; Matryoshka two-stage; dual-store | OpenSearch BM25 + vectors; **OpenSearch switch = +20.3% judge score** (single largest gain); **+21.6% F1** over Mem0 | Ablation shows temporal boosting underexplored (Mem0/Zep store timestamps but don't boost) | `arxiv.org/pdf/2604.19771v1` |
| **Mem0 / Zep / SuperMemory** | OSS memory layers | Persistent context across agent sessions | Timestamps stored but limited temporal boosting/session management; Cognis comparison point | Various | Provide version history (Cognis improves on them) | Cited in Cognis |
| **Time-Aware LMs / CRONKGQA / TempRALM** | Baselines in papers | Temporal facts/knowledge-graph QA | Dhingra '22 (expire facts, requires retrain), CRONKGQA (temporal KG assumes structure), TempRALM (chronological "what happened 2023?" not version "what changed v2.3?") | — | All lack version-to-version transition reasoning — VersionRAG's gap | Context in `arxiv.org/html/2510.08109v1` Table 1 |

**Noteworthy synthesis (from VersionRAG Table 1 — the only framework with all six):**

| Method | Version Awareness | Change Tracking | Temporal Filtering | Graph Reasoning | Hybrid Retrieval | Efficient Indexing |
|---|---|---|---|---|---|---|
| Standard RAG | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| GraphRAG | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| Time-Aware LM | ✗ | ✗ | ✓ | ✗ | ✗ | N/A |
| CRONKGQA | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ |
| TempRALM | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ |
| **VersionRAG** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

No row before 2025 checked the first three — Lekhan would.

### 3.4 Academic Consensus (October 2025 — October 2026)

- **VersionRAG (Oct 9 2025):** Standard RAG conflates versions (e.g., `assert.CallTracker` stability ambiguous across 14.21.3/15.14.0/16.20.2 where 16.20.2 marks deprecated). Requires `p(c|q,v)` not `p(c|q)`. Key primitives: version-aware graph (version nodes + content boundaries + change nodes), query classification (content vs version-listing vs change retrieval), and change detection (explicit mention vs implicit diff). Hybrid retrieval + graph wins; generic large-context stuffing fails.
- **TG-RAG (Oct 15 2025):** Same facts at different times are indistinguishable with vectors or conventional graphs. Proposal: temporal quadruple extraction (s,p,o,t) + hierarchical time graph (year→quarter→month→day summaries). Retrieval is time-windowed local vs trend-global. ECT-QA (earnings-call transcripts) evaluates both specific fact and abstract trend queries. Incremental updates and retrieval stability benchmarks exposed as blind spots.
- **Surveys:** Related work notes (§ Cognis) synthesize MemGPT complexity (paging) vs Cognis dual-store, Matryoshka embeddings, full version history, comprehensive temporal reasoning — Lekhan's offline + `y-indexeddb` vs Supabase chunk mirror is the same dual-store debate.

### 3.5 What Lekhan Should Borrow (and what no one has built for PKM)

**Borrow:**
1. **VersionRAG's change nodes + query classification.** For "what did we change about [[Roadmap]] between June and August?" Lekhan should store *change* edges derived from `page_versions` diffs (word-diff viewer already exists in `#82`) as graph metadata — not just chunks. Query classifier (content / version-inquiry / change-retrieval) routes retrieval.
2. **TG-RAG's hierarchical time summaries.** For "summarize how our pricing thinking evolved Q1→Q3" Lekhan can precompute per-tag/per-page time summaries (like NotebookLM *source grounding* but temporal). Hierarchical (monthly → quarterly → all-time) avoids retrieving every version chunk.
3. **rag-timetravel's dataset-version = pointer pattern.** `page_chunks` should not copy full indexes per snapshot — one table with `valid_from/until` or `version_id` + `updated_at` metadata filtering is cheaper. LanceDB's O(1) version pointer maps to Supabase's `chunk.version_id FK → page_versions.id` + `GIN on (page_id, valid_from)`.
4. **Cognis/temporal-rag's post-retrieval temporal boosting.** Even before full temporal graph, adding a reranker that boosts fresh chunks *and* respects explicit `valid_until` (e.g., meeting notes with `properties.due_date`) yields immediate value for "current answer" queries while keeping as-of path pure.

**No one has built:**
- **Cross-page temporal graph** over a *living PKM workspace* (Notion/Obsidian version history is per-page snapshots/file history, not graph-aware). Lekhan's `page_links`/`page_tags`/`properties` all evolve — temporal RAG should answer "which pages *used to* link to [[Auth]] in March?" (page_links temporal) — none of the papers model link/tag/property evolution jointly.
- **Permission-aware as-of queries** — `can_access_page` must scope both current and historical chunks (access-controlled time travel). No paper handles RLS + E2E degrade correctly.
- **Narrative change explanation** — "why did we change our mind?" requires synthesizing diff + meeting notes + decision context. Lekhan's Studio can generate this as a *new Page* (graph-native write) with citations to the before/after versions — the closest Studio+Temporal fusion.

### 3.6 Minimal Temporal RAG Shape for Lekhan (so it doesn't block H3 Studio v1)

Based on `docs/research/2026-08-29-…` §7 sequencing, temporal RAG is **not** in the Studio v1 critical path. The cheapest ordering that preserves the differentiator:

```
page_versions (exists, tiered)
      ↓
page_chunks {id, workspace_id, page_id, version_id FK?, ordinal, content, embedding halfvec(768),
             token_count, model, valid_from timestamptz, valid_until timestamptz nullable,
             created_at, tag_snapshot jsonb, link_snapshot jsonb}
      ↓  (incremental: on yjs save + import batch, transactional with page_links/page_tags)
hybrid_search(p_workspace_id, p_query, p_embedding, p_tag_filter, p_link_filter, p_as_of timestamptz nullable, p_between range nullable)
      → lexical (pg_trgm/tsvector) + vector (halfvec_cosine_ops HNSW, m=16 ef=200) fused by RRF
      → WHERE (p_as_of IS NULL AND valid_until IS NULL) OR (valid_from <= p_as_of AND (valid_until IS NULL OR p_as_of < valid_until))
      → AND can_access_page(page_id) (SECURITY INVOKER, service_role only index path)
      ↓
Studio / chat query classifier (content | as-of | between | changelog)
      → as-of: filter as above; between: return diff (page_versions word-diff + change nodes); changelog: aggregate change summaries
      → E2E workspace: fallback to IndexedDB/sidecar chunks mirror + transformers.js (nomic-embed-text 768d) — no server sees plaintext
```

- Start with **unified index + metadata filter** (not partitioned indexes per snapshot — cheaper, aligns with Chatnexus hybrid, fits Supabase `pgvector` HNSW). Partitioned snapshots can come if index size proves large (> ~50k chunks/workspace).
- Retention: reuse `lib/tier-limits.ts` tiers (Free 1d → only "current" meaningful; Plus 90d → windowed temporal; Pro 365d → full history for as-of "6 months ago").

---

## 4. Agent Compatibility: Should Lekhan Be Agent-Compatible? What Concretely?

### 4.1 Verdict: Yes — but in a specific order, for a specific reason

**Yes.** The PKM battle moved in 2026 from "which app has best UI" to "which app plays best with AI" (skiln.co Obsidian vs Notion MCP: "`Obsidian MCP` 1,600→2,900 searches/mo Jan→Apr 2026"). Every major SaaS now exposes data through MCP (GitHub, Slack, Drive, Postgres, Notion, Jira, Salesforce) — Microsoft Build 2026 declared MCP the **default integration layer** across Foundry/Agent 365/IQ/Copilot (97M monthly SDK downloads Mar 2026, 970× since Nov 2024, 78% of enterprise AI teams run ≥1 MCP agent in prod, 81k+ stars).

**For Lekhan, agent-compatibility means:** Claude Code (or Cursor, or a future Lekhan agent worker) can *search the workspace graph, read/write Pages by `[[title]]`, filter by tag/property, traverse links, and create Studio artifacts — all permission-aware, all on user's keys*. Without it, Lekhan is a beautiful walled graph. With it, Lekhan becomes context infrastructure.

**The nuance is *how* to be compatible** — three distinct investments with very different costs:

| Compatibility layer | What it is | What user says | Lekhan's role |
|---|---|---|---|
| **MCP server** (expose tools) | Lekhan implements the **JSON-RPC 2.0 / MCP** spec (Tools + Resources + Prompts over stdio or Streamable HTTP) so *external* AI clients (Claude Desktop, Cursor, Code, Windsurf, Copilot) connect to Lekhan's graph | "Ask Claude to read my [[Roadmap]] and create 8 epics tagged `inbox`" | **Server exposes tools; host (Claude/Cursor) creates client sessions per server.** |
| **MCP client** (consume tools) | Lekhan's *own* agents/workers (Custom Agents / Studio jobs) call *external* MCP servers (Box, GitHub, Slack, Linear, ClickHouse, …) | "Studio: watch my Notion inbox and generate Lekhan pages from it" | **Lekhan's agent runtime acts as host, spawning clients to external servers.** |
| **Plugin SDK + sandboxed runtime** | In-app extensions (Web Worker + iframe + postMessage) for themes/slash-commands/block types | "Install a graph-layout plugin" | **Host validates capabilities (`read:pages`, `write:pages`, `http:allowlist`) + CSP + postMessage nonce + analyzer** |
| **A2A (Agent-to-Agent)** | Agents delegate to other agents (JSON-RPC 2.0 + gRPC v1.0, signed Agent Cards) — MCP=USB-C (agent↔tool), A2A=TCP/IP (agent↔agent) | "Lekhan inbox agent delegates pricing research to Notion research agent" | **Future — after MCP server+client are stable.** |
| **Tool-use / function calling** (model-agnostic) | Underlying primitive: LLM → `Thought-Action-Observation` loop (ReAct) calling tools in loop `while(tool_call) → execute → feed → repeat` (Claude Code single-threaded master loop) | Irrelevant to user (internal) | All layers above reduce to this at runtime — provider-agnostic (Claude, GPT, Gemini, Ollama) |

### 4.2 What Competitors Are Doing (Aug 2026)

| Competitor | MCP server | MCP client / agents | Tool-use / SDK |
|---|---|---|---|
| **Anytype** | **First-party** `@anyproto/anytype-mcp` — auto-converts OpenAPI spec to MCP tools (`npx -y @anyproto/anytype-mcp` + `OPENAPI_MCP_HEADERS` bearer + `Anytype-Version`). Global & space search, spaces/members, collections. One-click for Clause/Cursor/Windsurf/Raycast + `claude mcp add` + headless `anytype-cli`. Docs at developers.anytype.io. | Headless CLI for automation (experimental) — not full Custom Agents platform | Open API + types, p2p |
| **AFFiNE** | **First-party built-in** (`affine.pro/mcp`) — stdio default or HTTP `/mcp`, Cloud + self-host (AI enabled). Unique: **whiteboard search** (Edgeless element/frame locators) — Notion/Obsidian gap. Free on both. | Not prominent yet — AI features internal | Community `affine-mcp-server` |
| **Notion** | **First-party hosted** `https://mcp.notion.com/mcp` via `mcp-remote` + OAuth; Notion API 2025-09-03; 4 tool families; also Airbyte `NotionConnector` + Scalekit proxy. Public MCP directory entry. | **MCP clients inside Custom Agents:** agents consume external MCP servers (Box, ClickHouse, Mercury, Miro, Mixpanel as of June 2026; plus Slack/Mail/Calendar/GitHub/Jira/OneDrive/Salesforce/Asana for Enterprise Search). Also `Notion 3.3 Custom Agents` (24/7, trigger/schedule, 20+ min multi-step). **Both server *and* client.** | Developer Platform (May 2026) + Workers deterministic code; API per `developers.notion.com/reference/intro`; MCP connectors pattern borrowed from Arcade/Foundry Toolbox |
| **Obsidian** | **No first-party server** (Aug 20 2026 AFFiNE guide + skiln review both confirm). **Community routes:** (1) **Local REST API plugin's built-in Streamable HTTP MCP endpoint** (direct, API-key protected, Obsidian must stay open, local+protected) — now default; (2) **Filesystem MCP** (read-mostly when app closed, raw `.md` files); (3) external bridge (client compat gap). Vault copy on machine where server runs; sync method (Sync/iCloud/git) irrelevant. **Desktop-bound, no phone MCP.** | Plugins invoke BYOK LLMs locally — not MCP consumers | Community plugins (unsandboxed); plugin marketplace |
| **open-notebook** | MCP integration for Claude Desktop / VS Code (documented) + **comprehensive REST API** (`:5055/docs`, OpenAPI) — user asked "Can I expose notebook to agents?" → via REST + MCP | LangGraph workflows (Ask, Chat, Transformation) + Esperanto multi-provider — not yet MCP-consuming agents | FastAPI + SurrealDB SDKs, job queue, `surreal-commands` |
| **Lekhan (today)** | **None** — graph index is `service_role` only (`REVOKE EXECUTE` from anon/authenticated, `server/graph-index.js:82`), search is `SECURITY INVOKER` `search_pages(p_query, p_limit)` via `pg_trgm`. No MCP tools. | **None** — Studio jobs planned but not built; import pipeline is one-way (Obsidian/Notion → Lekhan IR). | `lib/ai` registry + client (provider-agnostic SSE), Tauri sidecar planned, plugin API v1 `#44` (sandbox design spec requires attacker fixtures) |

### 4.3 Cost / Benefit of MCP Server vs Client vs Both

| Decision | Engineering cost | Why it pays | Why it hurts if rushed | Verdict for Lekhan |
|---|---|---|---|---|
| **Build MCP server (expose graph)** | **Low-Medium (weeks, not months):** Wrap existing `search_pages` / `hybrid_search` + `pages`/`page_links`/`page_tags`/`properties` CRUD as MCP tools. Tool schema ≈ `{search_pages, get_page, list_pages_by_tag, list_links, create_page, update_page, add_tag, hybrid_search}`. Auth = bearer token scoped to workspace (reuse Supabase auth + `can_access_page`). Transport = Streamable HTTP + stdio (FastMCP 3.0 one-decorator Python or TypeScript SDK). Deploy = alongside existing `server/index.js` or as edge function. Version = `Anytype-Version` style header. | **High leverage:** Instantly makes Lekhan workspace queryable from *every* MCP host (Claude Code, Cursor, Windsurf, Raycast, Copilot, Foundry Toolboxes) — no Lekhan-side agent runtime needed. Obeys BYOK (agent brings its own model key). Marketing: "`pip install lekhan-mcp` — your graph in Claude Code" = virality similar to Anything's `npx -y`. Enables eval: agents vs Lekhan Studio can be benchmarked same tools. Cheapest agent story to ship. | Must nail **permission-filtering by tool call** (never leak embeddings/private pages to unauthenticated client). Must rate-limit per workspace tier. E2E workspaces: server cannot expose plaintext — must either refuse or use client-side WASM index path (badge "Studio local only" same as Studio E2E caveat). | **Do first (H3.0, immediately after vector store lands).** |
| **Be MCP client (consume external tools)** | **Medium-High:** Requires in-workspace **agent runtime** (Custom Agents-like) — job queue (`studio_jobs`), trigger/schedule, tool whitelist, credits/budget (but Lekhan has *no credits* — so budget = user's BYOK quota). Plus auth per external server (OAuth for hosted, API keys for local). Also needs governance: agent scopes (`watch this Notion database` vs "do operations"). | **Completes the loop:** Studio can *import* from external toolkits (GitHub issues, Slack, Notion) as first-class graph ingestion, not just one-shot importer IR. Powers "generate epics from scattered notes + external threads" — the team wedge. Matches Microsoft/Notion's agent platform direction (Foundry Toolbox bundles MCP servers behind one URL). | The *runtime* is the cost (long-running workers, approval flows, human-in-the-loop, eval harness) — same as Notion Workers. Without constrained templates, risks Notion's "amplify disorder" pitfall. Don't build a generic "AI employees" story; build wrapped jobs that reuse `hybrid_search` + page creation tx. Also introduces external dependency reliability (MCP server downtime). | **Do second (H3.5), after Studio v1 + MCP server prove graph tools are useful.** Start with **one curated proxy** (e.g., GitHub) not open-ended connectors, to validate the `surreal-commands` / Supabase Queue pattern (`server/index.js` already has 2s/10s debounce ledger — extend to job queue). |
| **Both (full agent OS, like Notion)** | Sum of above + **foundry-like orchestration** (Toolbox per workspace, A2A delegation) | Mirrors where industry is heading (Microsoft Build 2026: MCP default + A2A for agent→agent, Agentic AI Foundation under Linux Foundation — Anthropic+Block+OpenAI Dec 2025 — contributes both specs). Enables Lekhan inbox-agent ↔ Notion research-agent delegation. | Highest scope, needs Linux Foundation–grade governance, MCP Registry (Q4 2026 verified servers), Server Cards discovery, OAuth 2.1+PKCE+SAML. Premature without proven MCP server adoption. | **Do third (H3+), after MCP server + one client integration ship and are audited.** |
| **A2A (agent-to-agent)** | **High** (new spec, gRPC + signed Agent Cards, discovery) | Future interoperability (Notion's agent delegates to Lekhan). Industry signal strong (v1.0 Apr 2025, gRPC added). | Spec still stabilizing (Q3 2026 coordination primitives, Q4 registry). No competitor other than Notion-Microsoft ecosystem uses it yet. | **Defer — track, don't build.** |

**Lean add:** For Lekhan's tier philosophy (no credits), MCP agent pricing stays simple: **workspace tier unlocks agent execution quota** (e.g., Plus: N Studio job runs/month; Pro: M; Team: per-seat + job concurrency) — not Notion-style `$10/1k credits` pooled burn. This keeps Lekhan's cost-safety promise (Strategy §6) intact — agent LLM calls still bill user's BYOK key, Lekhan only gates *execution count* (like history retention already tiered).

### 4.4 Concrete Recommendation for Lekhan (phased, cost-aware)

**Phase 0 — Foundation (pre-MCP, must come first):**
- Ship `page_chunks` + `pgvector halfvec(768)` + `hybrid_search` (feasibility §7). Without this, MCP `search` tools are just trigram — not competitive vs Notion Enterprise Search (vector+lexical RRF).

**Phase 1 — MCP server (H3 Studio v1 companion, weeks-level)**
```typescript
// Sketch — what Lekhan's MCP server should expose (mirrors Anytype auto-generation but hand-shaped for graph)
Tools:
  - workspace.search({ query, limit?, tag?, linked_to?, asOf? }) -> Page[]  // hybrid_search with permission filter + optional temporal
  - workspace.get_page({ id | title }) -> { page, links_out, links_in, tags, properties }
  - workspace.list_pages({ tag?, linked_to?, limit? }) -> Page[]           // graph traversal via page_links/page_tags
  - workspace.create_page({ title, parent_id?, content_md, properties?, tags? }) -> Page
  - workspace.update_page({ page_id, content_md?, properties_patch? }) -> Page
  - workspace.append_to_page({ page_id, markdown }) -> Page
  - studio.generate({ type: "brief"|"epics"|"table"|"quiz"|"deck"|"sheet", sources:{tag?, linked_to?, page_ids?}, instruction }) -> studio_jobs id
  - graph.traverse({ from_page_id, depth? }) -> { nodes, edges }             // page_links join — Notion has nothing like this
Resources: workspace://{id}/pages/{id}, workspace://{id}/graph
Prompts: "Briefing doc from [[Sprint Retro Nov]] + [[Incidents]]" (templated)
Auth: Bearer Supabase JWT or workspace-scoped API key (reuse `page_members` + `can_access_page`); audit each tool call.
Transport: FastMCP (TS) — `stdio` for local (Obsidian route), Streamable HTTP for remote/Claude Code/Cursor. Version header like `Lekhan-Version: 2026-08-30`.
Deploy: `server/index.js` alongside `graph-index.js` or Supabase Edge Function if self-host not needed.
```
- Ship alongside Studio so Studio jobs are *also* callable via MCP (`studio.generate`) — feature parity between UI and agents.
- For **E2E workspaces**: MCP server returns `error: E2E_ENABLE_LOCAL_INDEX` — client must fall back to local Tauri WASM chunks (same as Studio E2E caveat). Never proxy plaintext through server.

**Phase 2 — MCP client (H3.5, after Studio v1 + MCP server validated)**
- Add an **inbound connector** for one external system (GitHub issues or notion-read via `mcp-remote`) that Studio jobs can call as `external.search(...)` — reuse `surreal-commands`/`studio_jobs` queue (one worker polls `pending` → Tool → LLM via BYOK → `studio_create_pages` tx).
- Scope it narrowly: "Import board from GitHub: pages with properties `{status, assignee, sprint}`" — not "agent does ops."

**Phase 3 — Plugin SDK (H1 `#44` → H2 `#51`, parallel)**
- Sandboxed runtime (Worker+iframe+postMessage) with capabilities manifest + analyzer. This is *orthogonal* to MCP — plugins run inside Lekhan's UI process; MCP agents run outside. Keep both, don't conflate. Hostile-plugin test suite must pass before any MCP-exposed tool mirrors plugin API behavior.

**Phase 4 — A2A (H3+, watch)**
- Subscribe to Agentic AI Foundation specs (MCP Registry Q4 2026, Agent Cards). Don't implement until an integration partner (e.g., Notion-side) demands delegation.

**Why not the reverse (client before server)?** Notion chose agents *first* (Custom Agents Feb 2026) because they already had a cloud workspace with permissions + connectors to justify credit monetization. Lekhan's leverage is different: **local-first graph + open-core trust** — the fastest distribution is letting *external* agents (which users already pay for via Claude/Cursor seats) *bring their own Lekhan context*, not building a new agent runtime users must fund. Anytype and open-notebook chose server/auth-first for exactly this reason.

---

## 5. Implications for Lekhan H3 (Pivot to Studio + Temporal v2)

### 5.1 The Suite → Studio Pivot Is Correct — But Retell It as Graph-Root, Not Notebook Clone

The pivot (`#52-#55` office suite as typed views → **workspace-level NotebookLM-like Studio** as graph-root RAG with temporal v2) fixes a sequencing mistake, not a product philosophy mistake. Original H3 (§ Strategy §4) assumed Databases (`#47`) → Sheets/Slides (`#52/#53`) as linear unlock. Reality 2026: **Every** competitor re-centered on **grounded generation over live knowledge** (Notion Enterprise Search + Agents, AFFiNE AI, open-notebook Ask + Transformations, NotebookLM Studio as formatter layer). Lekhan without workspace-level RAG would ship Sheets as an empty grid.

The feasibility report's insight stands: *"Studio is a formatter layer over the grounded corpus"* — but Lekhan's corpus is not a static upload folder (NotebookLM 50 sources × 500k words, re-upload if source changes, no live sync). Lekhan's corpus is a **living graph** with incremental `graph-index.js` (`sync_page_graph` transactional, row-locked per page), permissions (`can_access_page`), and offline queue. That makes workspace-root RAG *more* valuable than notebook-isolated RAG (open-notebook / NotebookLM silos) — a query can scope to `tag:roadmap AND link:[[Auth]]` not flat folder.

**Implication:** Present Studio *not* as "NotebookLM for Lekhan" but as **"One graph, many Studios"** — Studio at graph root *is* the Sheets/Slides/Mail/Chat plan executed differently: G1 (epics/stories/briefing/table) writes *Pages with properties* that *become* the database rows Sheets will later render, O1/O2 export them as PPTX/XLSX, S1 renders as audio. The `properties JSONB` is the through-line. Don't rename H3 epics — show that Studio *is* the implementation of `#52/#53` as generative views, and keep `#47` (Databases) as the typed-view substrate they write into.

### 5.2 Temporal RAG as v2 Differentiator: Lekhan Is First in Position — But Don't Ship It Day 1

**Why it is a real wedge:**
- Every team asks "why did we change our mind?" and "what did we decide 6 months ago?" — this is tribal knowledge that search can't answer. Current tools treat version history as *restore* (AFFiNE Time Machine, Notion 90-day history, Obsidian file history via Sync/git) not *retrieval*. Lekhan would be alone in making history *queryable*.
- Lekhan's `page_versions` + tiered history is already in schema/migrations + `lib/version-history/` + word-diff viewer (`#82`). No competitor has a longer runway than 90 days (Notion Business) — Pro's 365 days is temporally RAG-ready; Plus's 90 days is windowed. No new table for retention — reuse.
- The academic gap is clean: VersionRAG 90% vs 58% naive, with **60% implicit change detection where baselines 0-10%**. That failure is exactly "we didn't announce the change — can you spot what we stopped doing?" — valuable for teams.

**Why not day 1:**
- Studio v1 already requires chunks + hybrid search + job queue + office renderers — per feasibility §7, this is weeks-level arch. Temporal adds `valid_from/until` or `version_id FK`, change nodes, query classifier, time summaries, reranker — another increment. Ship temporal as **Studio v2** after workspace-level Studio proves value (measured by: users actually query filtered corpora *before* they query history).
- Deployed naively (index all versions without `valid_until` windowing), temporal doubles/triples index size (each edit = re-chunk). The delta+snapshot hybrid + retention pruning must land first.

**Sequencing proposal:**
1. **H3 v1 (new, now):** Workspace-level Studio — Briefing/Epics/Table→Pages + Quiz/Flashcards + PPTX/XLSX/DOCX + Mind-map view. Backed by `page_chunks` + `hybrid_search` (current) + `studio_jobs` + `pptxgenjs`/`exceljs`. Cite per `[[Title §chunk]]`, permission-aware. Differentiator over NotebookLM: *writes back as Pages* (NotebookLM only generates reports; Lekhan creates graph nodes). Market as "Studio at graph root" — not "office suite."
2. **H3 v2 (follows v1, starts while v1 in review):** Temporal RAG — `as-of` / `between` / `changelog` queries over `page_versions`. Add `valid_from/until` + version-aware `hybrid_search` with `p_as_of` + reranker. Ship queries:
   - `As of {date}`: "What did our return policy say on Jan 31, 2024?" → `WHERE valid_from <= p_as_of AND (valid_until IS NULL OR p_as_of < valid_until)` (OpenSave is key enabler per Cognis ablation)
   - `Between {v1}..{v2}`: "What changed in [[Pricing]] between June and August?" → change nodes + word-diff + Studio-generated changelog Page (links to before/after versions)
   - `Implicit evolution`: "When did we drop support for X and why?" → hierarchical time summaries (TG-RAG) over version diffs + meeting pages that caused the change
   - UX: Studio job type `changelog` and chat slash `/time-travel` with version timeline scrubber.
3. **H3 v2.5 (parallel with temporal):** MCP server (`workspace.search` as-of aware) so agents can ask temporal questions too.

### 5.3 Agent-Compa​tibility Sequencing (to avoid Notion's credits trap and Obsidian's community-tax trap)

- **Don't wait for Perfect Agent OS.** Ship MCP server with vector store (Phase 1) — it costs weeks, unblocks demos ("Claude now sees my Lekhan graph") before Studio ships, and tests the graph tool design under real agent loops. Anytype's `npx -y` path shows adoption is driven by one-line install, not platform ceremony.
- **Don't copy Notion's credit dial.** Keep `no bundled credits anywhere` (Strategy §6). Gate agent execution by *workspace tier job quota* (count of Studio/MCP-triggered jobs per month, like history days already tiered) — LLM cost stays on user's BYOK key (their rate limits, their bill). This preserves Lekhan's unit-economics guarantee ($0 AI cost forever) and avoids the "Business required plus credits risk $hundreds" anti-pattern that every 2026 Notion review flags.
- **Don't copy Obsidian's plugin tax.** Lekhan's sandboxed plugin API (`#44` capability model: `read:pages`/`write:pages`/`http:allowlist`, consent registry, CSP `frame-src` only sandbox, `event.origin` + nonce + schema validation, hostile-plugin fixtures) is ahead — keep it ahead by auditing MCP tools with same framework. MCP and plugins are *different runtimes* (MCP = outside Lekhan process over stdio/HTTP; plugin = inside Web Worker/iframe) — don't unify prematurely.

### 5.4 What This Means for Roadmap & Blockers

- **H0 → H1 handoff intact.** Studio v1 consumes the import pipeline (`#26/#27` `importer → IR → graph` → `page_versions`) and global search (`#25` `pg_trgm`) substrate — no extra blockers if vector store is added as `server/graph-index.js:82` extension (chunks + embedding debounced 2s/10s, same cadence as sync hardening ledger). Don't introduce new epic blockers for Studio v1 — slice it as tasks under existing H3 epics `#52/#53` redefined as "Studio: grouped/typed views."
- **H2 `#47` Databases stays the hinge.** Studio G1 writes pages with `properties` schemas; Databases renders them. This creates a *virtuous cycle*: Studio generates structure → Database views expose it → users see value → generate more. Sequence databases landing *alongside* Studio G1, not after.
- **Create two narrow follow-on specs (not epics), not grand H3 rewrites:**
  1. `H3 Studio: Workspace-level RAG + Office Renderers` — re-spec `#52/#53` as Studio views (references feeder `docs/research/2026-08-29-…` §7). Test requirements: hybrid_search permission-aware, citations, job queue, pptxgenjs/exceljs.
  2. `H3 v2: Temporal RAG + Time-Travel Queries` — `as-of`/`between`/`changelog` over `page_versions`, with `page_chunks.valid_from/until` + query classifier + change-summary view. Contrast with Notion 90-day history (restore vs query) to keep wedge sharp.
  3. `H3 Agents: MCP Server` — `workspace.search`/`get_page`/`create_page`/`graph.traverse` tools, auth as `can_access_page`, FastMCP TS.
- **Pricing narrative stays clean:** Free tier is growth engine (local-first ~zero serve cost, no doc cap). AI never bundled (Bring Your Own delivers 2026 urgency — model choice locked to NotebookLM's Gemini is flagged as "Weak"; Lekhan's 12 providers + BYOL ollama/lmstudio is opposite). Team pricing is the moat vs Obsidian (native collab) and vs Notion at $20/seat (local-first speed + ownership + inclusions).

### 5.5 Open Questions to Resolve Before Spec (`/interview` → `/spec`)

1. **Chunk granularity vs Yjs block model:** Tiptap v3 + `lib/markdown/engine.ts`/`markdown-io.ts` already round-trip blocks. Should chunk boundaries follow Yjs blocks (block-level citation precision) or 800-token windows (better retrieval recall)? NotebookLM/LanceDB lean semantic chunking; VersionRAG leans content-boundary graph. Prototype both on one workspace.
2. **E2E promise vs server embeddings:** E2E per-workspace (`lib/crypto.ts` AES-256-GCM client-held) forbids server embeddings. Studio/MCP for E2E must be local WASM (`transformers.js` `nomic-embed-text` 768d or `all-MiniLM` 384d) + IndexedDB/sidecar `.lekhan/embeddings/` mirror. Is degrade to `search_pages` trigram acceptable for E2E v1 or must WASM embeddings ship with v1?
3. **Embedding model governance:** Catalog already has `all-MiniLM 384` fallback for light hardware + `lib/ai/catalog.ts:94` `HardwareTier`. Should workspace pick embedding model (Gemini `text-embedding-004` default via BYOK, else Ollama `nomic-embed-text`) or should Lekhan pin one for stability? Re-embedding on switch is expensive — trade freshness vs stability.
4. **Temporal retention vs storage cost:** `page_chunks` valid_until history multiplies storage. Free 1d vs Plus 90d vs Pro 365d tiers already tier cost. Should chunk retention mirror page_versions retention exactly, or should chunks be pruned faster (e.g., keep only milestone versions, not auto-save microversions)?
5. **Studio writes as Pages vs Artifacts:** Feasibility report recommends graph-native Pages (queryable, linkable, tag-filterable) for epics/briefs and downloadable files for PPTX/XLSX. Should slide-deck "revisions" (`Slide Revisions` pattern from NotebookLM Apr 2026) be Page edits (versioned via `page_versions`) or Storage artifacts (`studio_artifacts/<workspace>/<job>/`)? Affects citation & temporal RAG scoping.

---

## 6. Sources & File Pointers

### Primary Sources Consulted

- Lekhan repo ground truth: `CONTEXT.md:10`, `docs/adr/*`, `supabase/migrations/20260812000000_pages_graph_schema.sql:1`, `supabase/migrations/20260814000000_sync_page_graph.sql:9`, `supabase/migrations/20260817000000_global_search.sql:11`, `server/graph-index.js:82`, `lib/markdown/engine.ts:142`, `lib/export-utils.ts:1`, `lib/ai/provider-registry.ts:9`, `lib/ai/catalog.ts:4`, `lib/ai/types.ts:3`, `lib/ai/client.ts:16`, `lib/crypto.ts:29`, `lib/ai/vault.ts:5`, `lib/tier-limits.ts:9`, `docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md:40`
- Feasibility feeder: `docs/research/2026-08-29-notebooklm-studio-lekhan-feasibility.md` (NotebookLM pipeline, 6-stage + Vertex AI Vector Search, chunks+vectors design, job queue, BYOK TTS, incremental indexing)
- AFFiNE: `affine.pro` (pricing/cluster), `affine.pro/mcp`, `affine.pro/blog/obsidian-mcp-guide` (Aug 20 2026), aisotools/toolradar Aug 25-26 2026 pricing snapshots, GitHub `DAWNCR0W/affine-mcp-server`
- Anytype: `anytype.io` + `anytype.io/pricing` + `developers.anytype.io/docs/examples/featured/mcp` + `github.com/anyproto/anytype-mcp`, checkthat.ai/toolradar pricing (July-Aug 2026), NPM `@anyproto/anytype-mcp`
- Obsidian: `obsidian.md/pricing` + `obsidian.md/help/*` (teams/bases/properties), skiln.co `obsidian-review-2026` + `obsidian-mcp-vs-notion-mcp-2026` (Apr 2026), productivitybrief.com Bases/Mobile/CLI/cllaboration review (June 11 2026), relay.md Sync shared vault pricing, obsidianstats #collaboration (Aug 23 2026), practicalpkm/bases-plugin-overview
- Notion: `notion.com/pricing` (May 2026), `notion.com/releases/2026-02-24` (Custom Agents) + `2026-04-14` (cheapening), `notion.com/product/agents`, `notion.com/releases/2026-03-04` (MCP), perplexityaimagazine `notion-ai-review-2026` (May 25 2026), felloai/eessel pricing (Business $20 + $10/1k credits May 4 2026), `developers.notion.com/guides/mcp/overview`, June 2026 MCP connectors (Box/ClickHouse/Mercury/Miro/Mixpanel), airbyte `NotionConnector` + Scalekit `mcp-remote` path
- open-notebook: `github.com/lfnovo/open-notebook` (README, 32.5k stars, 3.7k forks June 2026) + `docs/7-DEVELOPMENT/architecture.md` (three-tier + SurrealDB tables) + issues `#372 SurrealDB` / `#712 Multi-user` / `#381 worker rework`, `deepwiki.com/lfnovo/open-notebook`, `starlog.is` Esperanto analysis (June 15 2026), agents-radar June 5 2026 (Agent Orchestration UIs), everydev.ai tools summary
- NotebookLM Studio (via feeder citations): `notebooklm.google`, `blog.google 2025-07-29` (Video Overviews + Studio multi-output) + `2026-06-08` (charts/xlsx/pptx factory), `support.google.com/answer/16206866`, `chinwendu.medium.com`, `dev.to/jubinsoni`, `emergentmind.com`, `digital-humans.org 2026-07-26`, `lilys.ai`, `arxiv 2504.09720v2`
- Temporal RAG / papers: `arxiv.org/abs/2510.13590` (TG-RAG Oct 15 2025) + `arxiv.org/html/2510.13590v1`, `arxiv.org/abs/2510.08109` + `arxiv.org/html/2510.08109v1` (VersionRAG, VersionQA 90% vs 58%), `arxiv.org/html/2606.26511v1` (Temporal Validity / supersession), `arxiv.org/pdf/2604.19771v1` (Cognis), `articles.chatnexus.io/knowledge-base/version-controlled-rag-managing-document-updates-and-history` (Version-Controlled RAG), `docs.lancedb.com/tutorials/agents/time-travel-rag`, `github.com/Ar-maan05/rag-timetravel` + `pypi.org/project/rag-timetravel` + `github.com/Emmimal/temporal-rag` + `github.com/danielhuwiler/versionrag` + `github.com/lancedb/lancedb`
- MCP / agents: Anthropic Model Context Protocol spec + `spec.modelcontextprotocol.io`, `dev.to/x4nent/complete-guide-to-mcp-2026` (97M dl, 81k stars), `arcade.dev/blog/microsoft-build-2026-agent-stack` (Foundry/Agent365/IQ, A2A), Microsoft Agent Framework 1.0 (Apr 2 2026, GH Copilot SDK, Agent Harness), `quickchat.ai/post/apis-for-ai-agents-from-mcp-to-custom-endpoints` (ReAct Thought-Action-Observation), skypath `skiln.co/blog/obsidian-mcp-vs-notion-mcp-2026` + `mcp.so/servers/*` directory (12k+ servers), `mymcptools.vercel.app/servers/affine` + `mcpgee.com/servers/affine-mcp-server`
- Hybrid search / infra (feeder carry-forward): `supabase.com/docs/guides/ai/hybrid-search`, `suparbase.com Hybrid`, `markaicode.com` (Ollama + pgvector halfvec + HNSW m=16 ef=200), `docs.lekhan.app` planned Fumadocs (per Strategy §12)

### Consistency Notes (pricing variance explained)

- Anytype pricing variance (Free 100 MB legacy vs 1 GB current) reflects beta→paid transition during 2026; current Aug 2026 verify is Free 1 GB · Builder $9 ($99/yr) · Co-Creator $19 — earlier $4/$10/$14 snapshots are staging.
- Obsidian Sync is listed as $4/mo annual vs $5/mo monthly in most 2026 reviews; $60/yr vs $50/mo figure depends on annual vs monthly billing.
- Notion AI credits were free through May 3 2026, then $10/1k credits — some May 2026 snapshots still show legacy free period. Rate gate 35-50% cheaper Apr 14 2026 is retroactive.

---

*Prepared for H3 spec — next step: `interview` → `spec` for `H3 Studio: Workspace-level RAG + Office Renderers` then `H3 v2: Temporal RAG + Time-Travel Queries` as follow-on.*
