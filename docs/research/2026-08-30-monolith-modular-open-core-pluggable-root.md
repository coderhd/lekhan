# Monolith vs Modular & Open-Core Licensing for Lekhan — Research Report

**Date:** 2026-08-30
**Context:** Lekhan is a Next.js monolith (`app/` + `components/` + `lib/` + `server/` y-websocket hub, Supabase Postgres). H3 envisions a pluggable root (H3 as iteration of Open Notebook) with H3 Studio at the graph root — thin v1 (flat corpus, prompt-only synthesis) + v2 temporal RAG. Plugin API v1 (`#44`) is specced as sandboxed Web Worker + iframe + postMessage (`docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md:8.2`). Tauri desktop (ADR 0003/0004) stores `*.md` + `.lekhan/` sidecar. Offline-first, Yjs per-page CRDT, team workspaces (`workspaces.is_team`) deferred to H2.
**Question:** Should Lekhan split the monolith now? What does Obsidian actually open-source vs keep closed, and how does AGPL+MIT compare? What would "a root where all modules are pluggable" look like, and what's the minimal modularity to make Studio pluggable without over-engineering?

---

## 0. Executive Summary

**Do not split the monolith in the next 12 months.** The right move is a **modular monolith with deep modules + a sandboxed plugin SDK** — exactly what the strategy doc already sketches. Notion, AFFiNE, and Anytype all validated the same choice at Lekhan's scale: keep one deployable, enforce strict internal seams, shard only persistence when forced, and make extensibility happen through a capability-gated plugin runtime — not through micro-frontends or microservices.

For licensing, Obsidian's model is **closed core + open API types + OSS third-party libs**; Lekhan's **AGPL (hub + app core) + MIT (client libraries / themes / plugins)** is strictly more open and gives a legally durable self-host escape hatch that Obsidian cannot. AGPL's cost is enterprise legal friction and a need for repo hygiene (license-boundary CI, per-directory map, SBOM). That cost is manageable now; defer dual-licensing and CLAs until a paying customer actually pulls.

Studio v1 needs three new seams inside the monolith — **chunks + `pgvector` + hybrid search**, **studio job queue**, and **renderer adapters** — all shippable as incremental migrations + one Edge Function + client-side `pptxgenjs`/`exceljs`. Temporal RAG (v2) is a date-aware overlay on `page_chunks`, not a new service, and should not block v1.

---

## 1. Monolith vs Modular for PKM/Knowledge Workspaces

### 1.1 When each wins — first principles

| Property | Monolith wins when… | Modular (services / MFE / plugins) wins when… |
|---|---|---|
| **Team size** | 1–6 engineers, one deploy cadence, shared domain model (Workspace/Pages/`page_links`) | 3+ autonomous teams that need independent deploys (Conway's law) |
| **Data locality** | Graph ops are transactional across `pages ↔ page_links ↔ page_tags ↔ searchable_text` (one `sync_page_graph` RPC) — cross-service joins would be distributed transactions | Subsystems have disjoint data (e.g., billing vs. editor vs. LLM gateway each own different tables) |
| **Consistency** | Yjs CRDT per-page WAL + `main_state.bin` + incremental `server/graph-index.js:82 indexPage` must be atomic per page (`supabase/migrations/20260814000000_sync_page_graph.sql:9` `REVOKE EXECUTE` → service_role only) | CRDT is sharded by workspace/page and can be owned by an isolated sync service with a clean state-vector API |
| **Operational cost** | One `next build` + one y-websocket `server/index.js` + Supabase handles infra; CI is `npm run typecheck && lint && test && build` | Team can afford distributed tracing, per-service RLS, inter-service auth, queue observability |
| **Latency** | In-memory joins for graph/backlinks/search (<50 ms) matter more than independent scaling | A hot subsystem (embeddings, TTS, Veo render) needs different CPU/GPU scaling than the web tier |
| **Ecosystem** | Extensions are capabilities over the graph SDK, not separate products | Extensions are standalone products with own storage/billing (Sheets, Mail, Chat as separate suites) |

A useful heuristic repeated across SaaS post-mortems: *"A common mistake early-stage teams make is prematurely decomposing into microservices. The operational overhead of distributed tracing, inter-service auth, and separate deploy pipelines can overwhelm a small team before PMF."* — and *"When a service genuinely needs to scale independently, extract it then."*

### 1.2 Real examples

#### Notion — monolith app, sharded persistence (the canonical counter-example to "split the app")

- **Structure:** Node.js monolithic backend for 5 years, 4 orders of magnitude growth. One `block` table held billions of rows (every page/element is a `block` subtree). Scaling crisis was **not** CPU in app code but Postgres `VACUUM` stalls → transaction-ID wraparound risk (writes stop entirely).
- **Decision:** Kept the monolith; **application-level sharding** of the DB only. 480 logical shards (schemas) across 32 physical RDS instances (later 96), partitioned by `workspace_id` (called `space_id`) so all blocks/transitive tables for one workspace live on one host (preserves single-host transactions, kills cross-shard joins). Routing in TypeScript: `space_id % 480`. PgBouncer for pooling. Native Postgres partitioning rejected for opaque routing.
- **Migration:** Double-write via audit-log catch-up (logical replication couldn't keep up) → 3-day backfill on 96 CPUs with version compare → sampled verification + dark reads → 5-min switchover (later zero-downtime via logical replication tooling). Reverse audit log prepared but never needed.
- **Lesson for Lekhan:** Notion waited too long — *"should have sharded earlier; waiting until the monolith was heavily strained added complexity."* But the app stayed a monolith throughout. The seam was at the **persistence layer**, not the UI. Lekhan's equivalent pressure point will be `page_chunks` + embeddings volume, not `app/` routes — so shard persistence or offload embeddings before splitting `app/`.

*Sources: BehindScale "Sharding Postgres at Notion" (2026-07-09); Notion engineering retrospectives; DEV LavX / Potato sharding notes.*

#### Obsidian — closed monolith + unsandboxed Community Plugins (maximally modular distribution, minimally isolated runtime)

- **Core:** Electron app (Chromium), CodeMirror 6 for editing, D3 + PIXI.js for graph canvas, markdown-it, Moment, MathJax, pdf.js, Prism. App code is obfuscated/closed. License: free personal/commercial; Catalyst (early access) / Commercial (org featured) are optional paid support tiers — **not** feature gates.
- **Distribution modularity:** 1,800+ community plugins and 300+ themes as separate repos, registry approval is **manual review once**, updates ship without re-review. Theme/plugin discovery is modular; runtime is not.
- **Runtime isolation: none.** Docs warn explicitly: *"Due to technical limitations Obsidian cannot reliably restrict plugins to specific permissions. Plugins will inherit Obsidian's access levels: can access files on your computer, connect to internet, install additional programs."* A plugin is `main.js` that may `require('fs')`, `require('electron')`, `child_process`, `fetch`, arbitrary DOM. No consent registry, no postMessage sandbox, no CSP per-plugin, no per-message validation. `isDesktopOnly` is advisory.
- **Consequence:** Power: plugins can batch-process vaults, embed webviews, talk to local tools — which is why the ecosystem is vibrant. Risk: supply-chain risk, filesystem exfiltration, unreviewed updates. Community mitigations are social (Plugin Observer + `SECURITY.md`) not technical.

*Sources: obsidian.md/license, forum.obsidian.md/t/what-is-the-tech-stack-currently/833, Obsidian API docs (plugin guidelines), Hacker News discussion on `help/plugin-security`, Obsidian GitHub `obsidian-api` repo, Plugin Observer Security Guide.*

#### Anytype — modular protocol + local-first peer-to-peer (the "no-cloud" modular extreme)

- **Structure:** Electron + TypeScript client, **30+ Gradle modules** on Android (`feature-chats`, `feature-object-type`, `core-ui`, Clean Architecture domain→data→presentation, Dagger root). Go middleware via JNI/protobuf for sync.
- **Protocol separation:** `any-sync` (open, DAG-based CRDT, local-first) + `any-store` (local object store). Infra is **four node types** — sync nodes (space shards), file nodes (IPLD), consensus nodes (ACL), coordinator nodes (config). Spaces are encrypted DAGs; backup nodes are blind replicas. Load distribution via modular + consistent hashing of spaces to partitions.
- **Tradeoff:** True data sovereignty and offline/P2P sync (LAN, no internet) — at the cost of running or trusting an Any-Sync fleet and a more complex data model (objects/types/relations are user-definable, not just pages). For Lekhan, Anytype validates that **protocol modularity** (clean sync transport + encrypted DAG) can coexist with a monorepo UI.

*Sources: anyproto/any-sync, anyproto/anytype-ts GitHub, Anytype docs tech.anytype.io/any-sync/overview, DeepWiki anyproto local-first + AnySync protocol.*

#### AFFiNE — monorepo, modular packages, but still a monolith (closest analog to Lekhan)

- **Layout:** Yarn monorepo `AFFiNE/` → `packages/{backend, frontend, common}` + `blocksuite/` (editor framework) + `tools/`. `packages/backend/server/src/{base, core/{auth,user,workspaces,doc,storage,sync}, plugins/{copilot,payment,oauth}}`. `packages/common/{infra, nbstore, graphql, y-octo}`.
- **Stack:** NestJS + Apollo GraphQL + Prisma + Postgres(+`pgvector`) + Redis (+ BullMQ) + Socket.io; frontend Rspack + React 19 + Jotai/RxJS; Rust `y-octo` via NAPI for Yjs merging / compaction / markdown parsing. Three platforms share `@affine/core`.
- **Sync:** Same as Lekhan conceptually: `Y.Doc → IndexedDB + y-websocket ↔ server Postgres+Redis pub/sub`. State-vector diff, `DocSyncPeer` / `nbstore` Workers keep UI responsive, Rust compaction (`compactPendingDocUpdates`) merges hundreds of incremental updates into snapshots.
- **Modularity:** Strict package boundaries via workspaces + shared types (`packages/common/graphql`, `infra`), but **one deployable** (Docker compose for self-host). `blocksuite` is the deep module that lets whiteboard + docs be "hyper-merged" without micro-frontends.
- **Lesson:** AFFiNE proves Lekhan's stack (Next.js + Yjs + Postgres + y-websocket) can stretch from PKM to whiteboard/databases **without Micro-FE**. The seam is at `blocksuite` / `y-octo` / `nbstore`, not at route boundaries.

*Sources: AFFiNE GitHub architecture guide, DeepWiki AFFiNE architecture docs (local-first, y-octo CRDT, nbstore sync, real-time collaborative editing), mintlify AFFiNE docs.*

#### VS Code — extension host as the reference for "pluggable root" done safely(ish)

- **Process model:** Main (Electron) + sandboxed renderer + **shared process** (hidden window for file watchers/terminals) + **extension host** (utility process per window, spawned from main, not renderer). Post-sandbox migration (2020–2023), renderers are sandboxed (no Node), extension host is **not sandboxed** but isolated (Node, can spawn children). IPC is `MessagePort` (web-API-compatible), not Node sockets, so sandboxed renderers can talk without hitting main.
- **Web extension host:** Browser `WebWorker` inside a sandboxed `iframe` (`webWorkerExtensionHostIframe.html`), hostname-hash validation (`v--<sha256(parentOrigin,salt)>` subdomain), CSP hashes, origin check on every `postMessage`, `event.origin` validated, `crossOriginIsolated` → `?vscode-coi=2` branch. Extensions declare `extensionKind: ["ui", "workspace"]` to pick host; only `browser` entry runs in this sandbox (no `child_process`, no `fs`, Worker API via `postMessage`-based LSP).
- **Security nuance:** Researchers flag that **non-web** extensions still have unchecked host filesystem access (5.6% of 52k extensions show suspicious behavior). VS Code's fix was **layered isolation + Workspace Trust**, not per-plugin capabilities. The honest lesson: even Microsoft ships unsandboxed extensions for power; the web sandbox is the one to copy for untrusted third-party code.

*Sources: VS Code blog "Migrating VS Code to Process Sandboxing" (2022-11-28), Extension Host docs, DeepWiki extension host architecture, VS Code `src/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html` + serve-web fix commit, arXiv 2411.07479 analysis.*

### 1.3 Trade-off matrix calibrated for Lekhan's invariants

| Dimension | Monolith (Next.js modular) | Modular services / MFE | What Lekhan actually needs (given Yjs + Tauri + Studio) |
|---|---|---|---|
| **Dev velocity (team = 1–2)** | One lint/typecheck/test/build, one env, one Supabase. Route groups + `lib/` seams are cheap. | Per-service env, versioned contracts, deploy matrices, tracing. Needs platform team. | Monolith wins until H2 team workspaces + agent fleet actually need independent scaling. |
| **Offline-first + CRDT** | Per-page Yjs docs, WAL, `main_state.bin`, incremental `indexPage` atomic — simple. Desktop `.lekhan/` sidecar reuses `server/wal.js` pattern. | Splitting sync/index/search into services risks two-phase commits (update persisted but index stale). | Keep index + storage in one transaction (`sync_page_graph`) as today; Studio chunker piggybacks on same debounce. |
| **Graph query locality** | `page_links`/`page_tags`/`searchable_text` joins are single-query, RLS via `can_access_page` (`SECURITY INVOKER` — `supabase/migrations/20260817000000_global_search.sql:11`). | Cross-service graph reads would need scatter-gather per workspace shard. | Keep graph index collocated with `pages` until chunk volume forces sharding (see §4). |
| **Plugin trust** | Sandboxed plugins already specced (Worker+iframe+postMessage, capability checks in host, consent registry per `plugin × workspace`, origin + nonce + schema validation, hostile-plugin fixtures — `strategy:8.2`). Shippable inside monolith. | MFE gives each plugin its own bundle but no stronger sandbox than iframe+Worker; adds remotes performance cost. | Plugin sandbox is the highest-leverage modularity — invest here, not in splitting `app/`. |
| **Tauri parity** | Monolith's HTTP API maps 1:1 to Tauri commands; file watcher + sidecar share `yjs-seed`/`markdown-io`. | Sidecars become first-class services (llama.cpp, embeddings, TTS) but need capability-scoped IPC anyway. | Monolith + Tauri plugin caps (`tauri-plugin-fs/sql/stronghold`, `externalBin` sidecars) is the idiomatic Tauri model (`tauri.conf.json` `externalBin`). |
| **Studio v1 flat corpus** | `hybrid_search(p_query, p_embedding, p_tag, p_link)` RPC + `pgvector` HNSW (768 dims, `halfvec`) fits in existing Postgres — no new infra. | Separate vector DB (Qdrant/Weaviate) adds ops and dual-source RLS sync. | `pgvector` is the right call — Supabase hybrid-search recipe + RRF is proven. |
| **Studio v2 temporal RAG** | Temporal edges are just `page_chunks` + `valid_at/expired_at` + time-hierarchy summaries as incremental `LLM` jobs — still one DB. | A dedicated temporal-graph service only pays off after corpus > 100k chunks with frequent invalidation. | Defer service boundary; ship bi-temporal indexing as a **temporal overlay view** on `page_chunks`. |
| **Performance isolation** | One hot loop (embedding or TTS) can stall `server/index.js` event loop — need worker offload. | Isolated service gives independent CPU/GPU. | Use **in-process adapters with queue offload** (Edge Function `studio-worker` + client `ffmpeg.wasm` / Tauri FFmpeg sidecar) rather than a service split. |
| **Deploy + self-host** | `docker compose` / Supabase hosting, one AGPL repo. Self-host escape hatch is credible (ADDR parity). | Multi-compose or k8s; self-host story fragments. | OSS adopters prefer one `git clone` that runs — AFFiNE/Bitwarden pattern. |

**Bottom line for §1:** For a CRDT PKM with offline replicas and a graph index, *modular monolith* dominates until team-workspace scale and Studio throughput force a service boundary. Notion and AFFiNE both proved you scale the **store**, not the app, first.

---

## 2. Obsidian's Actual Open-Source Strategy vs Lekhan AGPL + MIT

### 2.1 What Obsidian open-sources (and what it doesn't)

| Layer | Obsidian | License / access |
|---|---|---|
| **Main app (Electron)** | **Closed source** — obfuscated, no public repo for the product. Free to use but not open. | Proprietary (`obsidian.md/license`: "we own and reserve rights to our content, including code") |
| **Plugin API types + sample** | `obsidianmd/obsidian-api` (TypeScript `obsidian.d.ts`) + `obsidian-sample-plugin` | MIT-ish / public |
| **Docs / theme API** | Plugin/theme docs (`help.obsidian.md`) | Published, community-editable |
| **Third-party libs it bundles** | CodeMirror 6, D3, PIXI.js, markdown-it, Moment, MathJax 3, pdf.js, Prism — each credited in `Help → Credits` (`forum 833`) | Each project's own (mostly MIT) |
| **Community plugins/themes** | 1,800+ plugins, 300+ themes in `obsidian-releases` registry; each plugin repo is independent (mostly MIT) | Per-plugin (typically MIT) |
| **Sync / Publish / Catalyst** | **Proprietary hosted** — Sync is encrypted relay, Publish is hosting. Source not open. | Paid add-ons |

**Model:** classic proprietary freemium with a plugin commons. Moat = Sync/Publish + Obsidian brand/community. Community builds the long tail (Kanban, Dataview, Excalidraw…) without needing — or getting — access to the core.

**Why this matters for Lekhan:** the user note is correct — *"Obsidian does NOT share complete product as open source repo but they are open source libraries/modules (e.g., CodeMirror, etc.)."* Any "Obsidian is open source" claim is folk error; XDA's revisit piece calls it out explicitly as closed.

### 2.2 Lekhan's model: AGPL + MIT exception (open-core)

| Layer | License | Why |
|---|---|---|
| **Core repo + hub** (`app/`, `server/`, `supabase/migrations`, `lib/markdown`, sync/persister/ledger, WAL) | **AGPL-3.0-or-later** (`LICENSE:1`, `package.json:5 license: AGPL-3.0-or-later`) — network copyleft §13: host a modified version and let users touch it over the network → must offer corresponding source | Prevents proprietary SaaS cloning (the AFFiNE/AGPL threat model). Makes "self-host the same software" legally durable. |
| **Open-core exception** (`LICENSE:542` — *"As an additional permission under Section 7 … you may distribute … community plugins, client UI themes, and standalone client integration libraries that interface with Lekhan's public APIs under MIT"*) | **MIT for the three surfaces enumerated** — plugin, theme, client integration lib (the Shogo/Epicenter pattern) | Adoption layer: MIT at the edge kills enterprise `license-compatibility` blockers that AGPL at the edge would create. |
| **Boundary** (per strategy `§8.1` "where *running on our infra* begins") | Open: editor + Tiptap extensions, local-first sync engine, PKM core (graph/search/import/export), provider registry, SDK. Proprietary/hosted: managed sync relay, team admin/SSO, billing, Publish hosting — **not open at all** (hosted moat) | Clean story for self-hosters and auditors: your device is MIT/open, the managed service is AGPL (source-offered) if you re-host it. |

*Calibrated against peers:*

- **Shogo-ai:** AGPL on `apps/api` + `agent-runtime` + `shared-runtime`; MIT on `@shogo-ai/*` SDKs + Expo/Electron clients + shared UI/domain. Bidirectional `verify-license-isolation.mjs` (AGPL→MIT ok, MIT→AGPL leaks → CI fail). Documented per-directory map + `package.json#license`.
- **EpicenterHQ:** AGPL for all apps + server glue; MIT for exactly 10 embeddable toolkit packages (`data, workspace, ui, sqlite, sync, agent, field, identity, chat, agent-protocol`) with dependency-closure guard `bun run check:licenses` (MIT package must not reach AGPL). No CLA, no dual licensing until a customer pulls.
- **Anytype:** Core protocol AGPL-ish / Source-available lineage (Any-Sync is open, `anytype-ts` under "Any Source Available 1.0" — not OSI-open) — different tradeoff: more permissive infra hosting, less OSI credibility.
- **AFFiNE:** MIT for client + BlockSuite + y-octo; AGPL/Source-available edges for server Enterprise (varies by edition) — similar hybrid.

### 2.3 Risks & benefits of AGPL for a knowledge workspace (honest)

| Benefit | Risk | Lekhan-specific mitigation already / next step |
|---|---|---|
| **Anti-cloning:** §13 blocks a competitor taking `server/` + migrations and offering a closed hosted Lekhan. Community diffs flow back. | **Enterprise hesitation:** legal teams have AGPL blocklists; Fortune 500 procurement may require SBOM allowlist review (FlowVerify pattern). Google bans AGPL for its engineers — folk precedent. | Publish SBOM (`Syft` CycloneDX per release — §4 hygiene). Keep AGPL out of publishable npm surface (see Shogo/Epicenter boundary script) — client SDK stays MIT-clean. |
| **Self-host credibility:** "AGPL keeps the escape hatch structurally true" — if Lekhan ever relicensed, last AGPL cut can be forked (OpenTofu/Valkey precedent). | **M&A / funding diligence drag:** AGPL in dependency graph triggers extra scrutiny. | Keep mit license field accurate (`package.json:license`), add `LICENSE` per directory when split, document exception scope precisely (§7 additional permission). |
| **Community reciprocity:** improvements to `graph-index`, CRDT, markdown round-trip stay open. | **Compliance overhead:** running a modified AGPL service without offering source is violation. Need `Appropriate Legal Notices` + source-offer (§13). | Add `/api/source` + footer link to GitHub tree at deploy commit; host Corresponding Source zip as release artifact. Cheap, proven (Grafana/Bitwarden pattern). |
| **Zero cost to solo/small-team users:** running locally / internally never triggers §13 (internal use ≠ conveying). | **Copyleft scope folk fear:** myth that "touching AGPL taints whole org." Law is narrower: obligation = corresponding source of the AGPL program, not caller's proprietary app over arm's-length network boundary. Still, policy > law in many orgs. | Document integration boundary: calling Lekhan over HTTP/IPC is arm's length; statically linking AGPL code into a client would be stricter — architecture keeps plugins over `postMessage` not linked imports, so story is clean. Offer single-copy commercial exception only **if** a customer actually needs it (OSSAlt pattern) — don't build a CLA/license-sales machine pre-PMF. |
| **Proven open-core revenue:** AGPL → enterprise features (SSO, audit, dedicated infra) as paid moat works (GitLab, Grafana $6B, Nextcloud). | **Perceived virality scares contributors:** contributors may withhold if CLA feels like rights grab. | Follow Epicenter: **no CLA now**. Accept contributions under inbound=outbound AGPL; only introduce CLA if dual-licensing becomes real (one customer pull). |
| | **AGPL on libraries is adoption-fatal** (xNet note: every local-first peer — Automerge, Yjs, Jazz — is MIT/Apache). | Lekhan already avoids this — plugin SDK/themes are MIT. Never publish an AGPL dependency from an MIT package. |

**Net assessment:** For a workspace that promises "your files, your AI" (`PRODUCT.md:24` positioning), AGPL is the **structurally honest** choice — it legally enforces the escape hatch. For SaaS conversion, it is not fatal but requires adult repo hygiene that Obsidian avoids by staying closed. Trade Obsidian's short-term enterprise ease for Lekhan's long-term sovereignty credibility — with the escape valve of a future commercial exception if an enterprise actually asks.

### 2.4 Comparison table Obsidian vs Lekhan (what the user will be asked about)

| Question | Obsidian answer | Lekhan answer |
|---|---|---|
| Can I audit the core? | No — obfuscated, closed. | Yes — AGPL repo, tag-pinned source offer. |
| Can I fork and self-host the product? | No — must rebuild from scratch; Sync/Publish are closed services. | Yes — AGPL gives the right (comply or buy exception). Migrations + WAL are in-repo. |
| Are plugins sandboxed? | No — unsandboxed, `fs`/`child_process`/`fetch` by default. | Yes (design) — Worker+iframe+postMessage, capability-scoped, host-enforced checks. |
| Are client SDKs safe for proprietary apps? | N/A (no official SDK; plugins must be AGPL-compatible in practice). | Yes — MIT client libs per `LICENSE:548` exception. |
| Who monetizes? | Obsidian Sync $4–5 / Publish $8–10 per site. | Lekhan managed hub + Team SSO/admin — hosted convenience, same as Obsidian model but source-open. |
| Enterprise blocker? | Low (proprietary). | Medium (AGPL) — mitigated by SBOM + MIT edge + source-offer endpoint. |
| Community flywheel? | Extremely strong (1,800 plugins despite unsandboxed) — proves distribution modularity matters more than core openness. | Must replicate distribution modularity with *better* sandbox; v1 plugin SDK is the test. |

---

## 3. Pluggable Root Architecture — "all modules are pluggable"

> Design vocabulary (per codebase-design skill): **seam** = interface boundary where code can vary independently; **adapter** = thin translation at the seam; **depth** = how much detail the module hides from callers (deep modules hide complexity). A good seam makes a module deep — few concepts leak outward.

**Invariant (Strategy §3, CONTEXT.md:3):** *Workspace is the root, Pages are nodes, `page_links`/`page_tags`/`page_versions` + `graph index` are derived, `properties JSONB` is the typed-view substrate. "One knowledge graph, many views."* Every option below must answer: **where does the graph live, and what is the Studio seam?**

### 3.1 Option A — Next.js monolith with deep modules + feature flags (status quo, evolved)

**What it is:** Keep `app/` as one build, but enforce **deep module** boundaries inside it via `dependency-cruiser` + `packages/*` workspaces (AFFiNE's `packages/common/*` applied to Lekhan). Feature flags (`lib/feature-flags.ts`) gate H3 views until ready. Progressive migration (Strategy Approach B) stays.

**Modules:** `packages/graph/{schema,index,search}` (today `server/graph-index.js` + `supabase/migrations/202608*`), `packages/crdt/{wal,persister,ledger,yjs-seed}` (`server/wal.js` pattern + `lib/yjs-seed.ts`), `packages/editor/{extensions,markdown-io}` (`lib/markdown`, Tiptap), `packages/ai/{registry,vault,client}` (`lib/ai/*`), `packages/sync/{hub,replica,sidecar}` (y-websocket + Tauri file watcher), `packages/studio/{chunks,embed,jobs,renderers}` (new), `packages/plugins/{host,runtime,capabilities}` (new — the v1 SDK).

| Seam | Adapter | Depth | Graph lives… |
|---|---|---|---|
| `GraphIndex.indexPage(pageId) → void` (today) + `ChunkIndexer.indexPage(pageId) → chunks[]` (new) | `lib/markdown/engine.ts:142 parse ↔ serialize` + `server/graph-index.js:82 extractLinks/Tags` + new `chunkAndEmbed` (800 tok, 150 overlap) adapter reuses same `plainText`. | Deep: caller doesn't know about `halfvec`/`HNSW`/`tsvector`. | **Postgres is the source of truth** (`workspaces/pages/page_links/page_tags/page_versions` + new `page_chunks`). Supabase RLS via `can_access_page` remains the permission gate. Studio hybrid search is a single `hybrid_search()` RPC in this seam. |
| `ProviderRegistry.resolveChatRequest` (`lib/ai/provider-registry.ts:9`) | `AIClient.stream` + `TTSCatalog` adapter (`lib/ai/tts-provider.ts`) mirrors existing BYOK adapter (local `http://localhost:11434` vs cloud `x-ai-api-key`) | Deep: Studio job doesn't know if TTS is OpenAI vs ElevenLabs vs local Piper. | Same DB — chunks carry `model` column for re-embed on provider switch. |
| `StudioJob.enqueue({type, input}) → jobId` / poll | `studio-worker` Edge Function consuming `studio_jobs` table (pending → processing → done) — adapter over existing Supabase Queue/`pg_cron` + Storage `studio_artifacts`. | Deep: UI only sees job status + final `pageId` or `output_uri`. | Graph: Studio **writes back as Pages** (`studio_create_pages` bulk tx) → `page_links` auto via `sync_page_graph` — Studio outputs are native nodes, not side files. |

**Pros:** Zero new infra; `npm run typecheck/lint/test/build` still covers all; RLS stays unified; Tauri can call same RPCs. Fastest to H3 v1.
**Cons:** One event loop; hot embeddings/TTS need Worker offload (solved via queue + client `ffmpeg.wasm`, not a service split).
**Studio fit:** v1 thin (flat corpus) = `hybrid_search` + prompt + `studio_create_pages` + `pptxgenjs`/`exceljs` renderers in `lib/studio/renderers.ts` (client-side, zero server render) + Storage artifacts — all inside this seam. No new service required.
**When to choose:** Now → next 12 months. See §4.

### 3.2 Option B — Micro-frontends (module federation / independent deploys per view)

**What it is:** Each H3 view (Studio, Databases, Sheets, Slides, Mail, Chat) ships as a separate micro-frontend (e.g., `apps/studio`, `apps/sheets` with Webpack Module Federation / Vite federation), loaded at runtime into a shell.

| Seam | Adapter | Depth | Graph lives… |
|---|---|---|---|
| Shell ↔ MFE via `Remote` entry + shared `packages/graph/types.ts` contract | Wrapper that maps MFE events → `POST /api/pages` / `hybrid_search` | Shallow unless contract is deep — each MFE tends to leak graph details. | Still Postgres, but now MFEs must each enforce RLS correctly (more surface). Studio would live as `apps/studio` with its own `studio_chunks` cache — risks stale linker state. |

**Pros:** Independent release of Slides without shipping Editor; team-ownership friendly at 20+ engineers.
**Cons:** Shared Yjs doc + `blocksuite`-style editor is **anti-MFE** — CRDT merges prefer shared `Y.Doc` store (`blocksuite` proves docs+whiteboard fuse better in one bundle). Bundle duplication, remotes performance overhead, Tailwind/Geist design tokens (`DESIGN.md`) fragment, offline story complicates (which MFE caches which replica?). Auth/session across remotes needs careful `postMessage` replay.
**Studio fit:** Poor — Studio needs to **write Pages** (graph mutations) and read `page_links` globally; an isolated Studio MFE would still call the same hybrid_search RPC. The split buys little.
**Verdict:** **Do not adopt.** Premature at Lekhan scale; AFFiNE explicitly didn't — AFFiNE uses packages+shared `blocksuite`, not MFEs, even though it fuses docs+whiteboard.

### 3.3 Option C — Plugin SDK + sandboxed runtime (Web Worker + iframe + postMessage) — the strategy's §8.2 design

**What it is:** Host keeps the graph; plugins are untrusted third-party code running in **two layers**: `Web Worker` (compute, no DOM) and sandboxed `iframe` (UI), communicating only via validated `postMessage` over `MessagePort`. This is the VS Code web-extension model + Lekhan's capability spec.

**Spec (from `strategy:8.2`):** Typed SDK (`read/write pages, links, tags, properties`), extension points (sidebar panels, block extensions, slash commands, themes), capability model (`read:pages`, `write:pages`, `read:graph`, `http:<allowlist>` declared at install + user consent per `plugin × workspace`, revocable; CSP forbids `unsafe-eval`, `frame-src` only sandbox origin; every message validates `event.origin`, per-session nonce (replay prevention), payload schema before host dispatch; hostile-plugin fixtures must pass; static analyzer checks declared caps ↔ actual API usage).

| Seam | Adapter | Depth | Graph lives… |
|---|---|---|---|
| `PluginHost.invoke(capability, args) → result` (host-enforced) + `postMessage({nonce, capability, args})` wire | `packages/plugins/host` (main thread, owns graph + RLS) ↔ `packages/plugins/runtime` (Worker+iframe, scheduler, CSP) + `vscodeWebWorkerExtensionHostIframe.html`-style origin-hash validation | **Deep:** plugin only sees SDK types; never sees `Y.Doc`, `supabase`, or raw SQL. Host mediates every write through `can_access_page` + `sync_page_graph`. | **Host-owned graph** — plugins never hold their own store; they read via `pages/search/pages_links` RPCs and write via `PluginHost.createPage`. Studio as a plugin would still hit the same hybrid search seam behind the host, so citations remain `[[Page §chunk]]` verifiable. |

**Pros:** Strong trust model (the Obsidian gap closed), marketplace-friendly, boundary CI enforceable (`verify-license-isolation` analogue: `plugin SDK` is MIT, host is AGPL — MIT must not import AGPL, same check Epicenter uses). Survives Tauri (Tauri plugin `allow-execute` caps map to same allowlist). Enables themes and community importers without touching core. VS Code proved this is the durable extensibility model — renderer sandboxed since 2023, extension host isolated.
**Cons:** More design up-front (nonce, schema, CSP, revocation UX). Initial SDK is narrow — block extensions require `BlockSuite`-like extension point not yet in Tiptap; start with panels/slash/commands/themes.
**Studio fit:** Studio **should not be a plugin** (it's a first-party graph-root view), but Studio's **renderers and chart plugins** should be plugins — e.g., a "Slidecast renderer" plugin that takes Studio job JSON and produces `pptxgenjs` output in the sandbox without widening host attack surface. Studio itself stays in the monolith (Option A) and exposes an `MCP-like` tool surface that plugins call (see Option E).
**Verdict:** **Build this next** (after Studio v1 core). It is the minimal modularity that makes "all modules pluggable" true while keeping the graph authoritative. Epic #44 (`Plugins API v1`) already queues it as the open-core unlock.

### 3.4 Option D — Tauri sidecar + local services (Rust sidecars, `externalBin` / NAPI)

**What it is:** For desktop, run heavy work as **sidecar binaries** spawned by the Rust host: `llama.cpp` (already planned `#88-M2`), optional local vector indexer (Rust `y-octo`-style), optional `ffmpeg` for slidecast stitching, SQLite mirror for offline `page_chunks`.

| Seam | Adapter | Depth | Graph lives… |
|---|---|---|---|
| `tauri_plugin_shell::ShellExt::sidecar("llama.cpp").args([…])` + capability file `src-tauri/capabilities/default.json` (`shell:allow-execute` with `sidecar:true` + validator regex) | JS `Command.sidecar` frontend ↔ Rust `shell().sidecar()` (Rust side) + shared SQLite/`.lekhan/embeddings/` cache | Deep for LLMs/TTS — UI just calls `invoke("run_llama", prompt)`; shallow for graph (file watcher must still merge CRDT → rewrite `.md` per ADR 0004). | **Dual:** cloud Postgres (collab, search) + **local `.lekhan/` mirror** (ADR 0003 WAL+snapshots + Tauri SQLite chunk cache for offline/E2E). Reconciliation via y-websocket relay when online. |

**Pros:** Native perf for embeddings/LLM/TTS, offline Studio, E2E-compatible (local chunks never hit server, per ADR 0001 parity matrix). Tauri's sidecar model is idiomatic (`externalBin` per-arch suffix `-$TARGET_TRIPLE`, `tauri-plugin-fs/sql/stronghold`).
**Cons:** Per-platform binaries, signing/notarization, updater complexity, `ffmpeg.wasm` vs native binary drift. Ties "pluggable root" to desktop — web/PWA must still have a `pgvector` path. Don't prematurely run Postgres-equivalent logic off-device.
**Studio fit:** Required for **E2E + offline Studio**: `transformers.js` WASM embeddings in IndexedDB (web) or Rust embeddings via `y-octo`-pattern NAPI in `packages/frontend/native` (AFFiNE pattern) for desktop. Sidecar stores `halfvec` cache in `.lekhan/embeddings/` and hybrid search falls back to brute-force cosine for <1k chunks (fine) or `hnswlib-wasm`. **But Studio v1 flat corpus can ship without this** — E2E workspaces show degraded badge until shipped (ADR 0001 tradeoff is already documented).
**Verdict:** **Plan for it, stage after v1.** Build the sidecar *interface* now (one adapter type `LocalEmbedder | RemoteEmbedder` behind `hybrid_search`), defer the binary until `#88` Tauri shell lands (Nov). Don't let it gate Studio v1.

### 3.5 Option E — MCP server as pluggable interface

**What it is:** Expose Lekhan's graph as **Model Context Protocol** tools over stdio/HTTP: `search_pages`, `list_pages`, `read_page`, `create_page`, `get_links`, `get_tags`, `hybrid_search` — consumed by Claude/Agents, local LLMs, and third-party apps. Same seam as the plugin SDK but **outside** the UI.

| Seam | Adapter | Depth | Graph lives… |
|---|---|---|---|
| MCP `tools/list` + `tools/call` JSON-RPC over per-workspace bearer token (Supabase JWT → `can_access_page`) | `packages/mcp/{server,tools}` adapter that translates `MCP CallTool` → `supabase.rpc("search_pages")` / `supabase.from("pages").insert()` | **Deep:** tool schemas hide `workspaces/pages/page_links` columns; clients only know `workspace_id + query` | **Graph stays in Postgres**; MCP is a **view** (AFFiNE's "one graph, many views" taken literally — Mail/Chat as agents calling MCP). For local E2E, MCP server can also run as **stdio sidecar** (`Command.sidecar("lekhan-mcp")`) reading `.lekhan/` mirror. |

**Pros:** Instantly pluggable: Agents, Sheets/Excel, Raycast, Alfred — without modifying `app/`. Mirrors the BYOK/BYOL story (agent brings its own model, Lekhan brings the graph). Shared with Tauri: same tool list drives desktop AI features. No deployment split — MCP server can be a single route `app/api/mcp/route.ts` + stdio binary for desktop.
**Cons:** Auth + rate limiting + RLS per-tool must be as careful as the plugin host (tool = capability). Needs request logging + tool allowlist per workspace. Doesn't solve embedding/storage — just an interface.
**Studio fit:** Studio's "v2 temporal RAG" is **best expressed as MCP tools** — `hybrid_search` returns `chunks[] + provenance`, generator composes, `create_page` writes. A Temporal Agent (OpenAI cookbook pattern: `valid_at/invalid_at` + `invalidated_by` edges) can be an MCP **skill** that mutates `page_chunks.valid_at/expired_at` without the UI caring. H3 Mail/Chat (`#54/#55`) also ride MCP — *mail threads as linked pages* (`docs/superpowers/specs/*`) are just pages with `properties.type=thread` produced by an agent tool.
**Verdict:** **Add MCP tools in parallel with the plugin SDK** — small surface, high leverage. It makes "root where all modules are pluggable" true for both human plugins (Option C) and agent modules (Option E) with one graph seam.

### 3.6 Summary — options at a glance

| Option | Seam depth | Isolation | Graph location | Infra cost | Studio v1 fit | Studio v2 temporal fit | When it pays off |
|---|---|---|---|---|---|---|---|
| **A — deep-modules monolith** | Deep (HNSW, RLS hidden) | Process (one deploy) | Postgres (source of truth) | + `vector` ext + 1 job table | **Best** — ship in weeks | Good as overlay view | Now → H2 |
| **B — micro-frontends** | Shallow (contract leaks) | Bundle | Still Postgres | MFE build infra | Poor | Poor | Only at 20+ eng, multi-brand shells |
| **C — sandboxed plugin SDK** | Deep (capability-gated) | Worker+iframe+postMessage | Host-owned Postgres | + CSP/nonce/host fixtures | Supports renderers as plugins | Supports chart plugins as plugins | Next after v1 (unlocks marketplace `#51`) |
| **D — Tauri sidecars** | Deep for AI, shallow for graph | OS process (sidecar) | Dual (Postgres + `.lekhan` mirror) | Binaries + signing | Needed for offline/E2E | Needed for local temporal graph | Stage after `#88` (Nov) |
| **E — MCP tools** | Deep (tool schemas) | Network (JWT per tool) | Still Postgres | + `app/api/mcp` route | **High** — unblocks agent-driven Studio | **High** — temporal agent as MCP skill | Add spec alongside C (small lift) |

---

## 4. Recommendation — Lekhan's Next 12 Months

### 4.1 Decision: stay a monolith, deepen the seams, add two extension surfaces

> **"Modular monolith, not micro-anything."** Keep one Next.js build, one Supabase project, one deploy. Invest the modularity budget in **depth of modules** (AFFiNE pattern) + **two pluggable extension surfaces** — sandboxed plugin SDK (C) and MCP tools (E) — plus a staged local sidecar interface (D) behind an adapter.

Specifically:

1. **Do not extract services for Studio.** `pgvector` in Supabase handles flat-corpus hybrid search within the existing RLS envelope. The hybrid recipe is proven: `chunks(page_id, ordinal, content, embedding halfvec(768), workspace_id, model)` + `HNSW halfvec_cosine_ops` + `tsvector` + RRF. That's AFFiNE's `Postgres+pgvector+Redis` pattern minus Redis — Supabase covers it until proven hot.
2. **Do build Studio v1's three seams inside the monolith** (see §4.2). No distributed transaction between index + search + page creation — one `studio_create_pages` tx that internally calls `sync_page_graph`.
3. **Do ship the plugin sandbox (C) and MCP (E) as the "pluggable root"** — they make every H3 module (Sheets `#52`, Slides `#53`, Mail `#54`, Chat `#55`) pluggable without splitting the graph. H3 modules remain *views over the same `pages/properties/links` tables* (Strategy §4), renderers live in plugins/sidecars.
4. **Defer micro-frontends (B) indefinitely.** Evaluate only if two independent teams ship conflicting release trains on the same route.

### 4.2 Minimal modularity needed for H3 Studio to be pluggable

**Studio v1 — flat corpus, incremental, permission-aware, offline-tolerant, citable, exportable.** Arch cost is *store + queue + renderers*, not LLM quality (per `docs/research/2026-08-29-notebooklm-studio-lekhan-feasibility.md:3`).

Build in order — each is a PR-sized deep-module change, not a service:

| # | Seam (what you ship) | Files / migration | Effort | Unblocks |
|---|---|---|---|---|
| 1 | **`page_chunks` + hybrid search** | Migration: `CREATE EXTENSION vector` + `page_chunks(id uuid, workspace_id uuid denorm, page_id uuid FK → pages ON DELETE CASCADE, ordinal int, content text, embedding halfvec(768), token_count int, model text, valid_at timestamptz DEFAULT now(), expired_at timestamptz, updated_at)` + `UNIQUE(page_id, ordinal)` + `HNSW(halfvec_cosine_ops)` + `GIN on content` (or `tsvector`). Function: `hybrid_search(p_workspace_id, p_query text, p_embedding halfvec, p_tag_filter text, p_link_filter text) → table(page_id, chunk_ordinal, content, rank)` via RRF (Supabase recipe). RLS: `WHERE workspace_id = p_workspace_id AND can_access_page(page_id)` — **filter before top-k**. Debounce: extend `server/graph-index.js:indexPage` (today `90%` of strategy) → also call `chunkAndEmbed(seedToYjsBase64 plainText)` (800 tokens, 150 overlap via `lib/ai` tokenizer `tiktoken-rs` pattern) with same 2s/10s capped debounce ledger (`supabase/migrations/20260827220000_sync_hardening_ledger.sql`). Embedding provider via workspace setting: default Gemini `text-embedding-004` via user's BYOK (zero Lekhan cost) or Ollama `nomic-embed-text` for E2E. | 1.5 weeks | All Studio (G1/O1-3/L1-2), `hybrid_search` MCP tool |
| 2 | **`studio_jobs` + `studio_artifacts` Storage + Edge Function** | `studio_jobs(id, workspace_id, user_id, type text {briefing,epics,table,mindmap,quiz,slides,sheet,doc,audio,narrated}, status {pending,processing,done,failed,cancelled}, input jsonb {source_filter: {tags,links,page_ids,query_text}, style, length}, output_uri text, citations jsonb [{page_id, ordinal, snippet}], model text, created_at)` + bucket `studio_artifacts` (RLS via `can_access_page` helper). Edge Function `studio-worker` polls `pending` → `hybrid_search` → assembles prompt (top-k=12 chunks) → `AIClient.stream` via BYOK key (`lib/ai/client.ts:16`) → validates citations exist (staleness check) → either `studio_create_pages` or `storage.upload`. Implements multi-create (4 tiles), cancel, progress. | 1 week | Audio/video/image later, slide revisions |
| 3 | **`studio_create_pages` transactional writer** | `CREATE OR REPLACE FUNCTION studio_create_pages(p_workspace_id, p_parent_id, p_pages jsonb) → jsonb` — loop inserts into `pages` + `page_links` via existing `sync_page_graph` path, returns `page_ids[]`. RLS: `owner_id = auth.uid()` (today one personal workspace `UNIQUE(owner_id)` — future `workspaces.is_team` adds member check). Studio outputs become graph nodes (Strategy "many views" + feasibility G1). | 2 days | Graph-native wedge (epics/stories/tables as typed pages) |
| 4 | **Office renderers (client-side, zero server render)** | `lib/studio/renderers.ts`: `renderDeck(json) → pptxgenjs@3` + `renderSheet(json) → exceljs@4` parallel to `lib/export-utils.ts:284 exportToDocx / 340 exportToPdf` + `lib/markdown-export.ts:92` (reuse `html2canvas` for chart → PNG). `chart.js` block for reports. Each exporter: LLM → JSON spec → client renderer → `downloadBlob` (feasibility O1–O4). Slide revision = single-slide regen endpoint `studio_jobs` child job. | 1 week | PM PPT/Excel/Doc request, report charts |
| 5 | **Plugin sandbox v1 + MCP tools (the pluggable root)** | `packages/plugins/{host,runtime,capabilities}` per Strategy §8.2: host `PluginHost` (main thread) owns graph; runtime is Worker+iframe with `webWorkerExtensionHostIframe.html`-style origin-hash validation, `event.origin` check, per-session `nonce`, `payload schema` validation; CSP `frame-src` locked; consent registry `plugin_consents(plugin_id, workspace_id, caps, granted_at)` revocable; hostile-plugin fixtures (exfiltration via `fetch`, `fs`, `child_process`). MCP `app/api/mcp/{tools/*}` surface exposing same `search_pages/hybrid_search/read_page/create_page/get_links`. AGPL↔MIT boundary guard: `scripts/verify-license-isolation.mjs` analogue — MIT packages must not import AGPL. | 1.5 weeks (narrow v1: panels + slash + commands + themes; block extensions deferred to H2 when DB views ship) | Marketplace `#51`, renderers-as-plugins, agent modules (`#54/#55` ride MCP) |
| 6 | **Adapter seam for local/offline/E2E (interface now, binary later)** | `lib/ai/embedder.ts`: `type Embedder = { embed(texts:string[])→ halfvec[]; dim:number }` with impls `RemoteGeminiEmbedder` (BYOK) vs `LocalTransformersEmbedder` (`transformers.js` `Xenova/nomic-embed-text` / `all-MiniLM 384` fallback `HardwareTier light/medium/heavy` — `lib/ai/catalog.ts:94`). Web: IndexedDB `chunks` mirror; Tauri: `.lekhan/embeddings/` + Rust sidecar stub. Search: `hnswlib-wasm` or brute-force <1k chunks. Show "Studio (local)" badge for E2E (ADR 0001 parity matrix). | 1 week (adapter + WASM) + deferred Rust sidecar to `#88` | Offline/E2E Studio without blocking v1 |

*Total meaningful H3 Studio v1 path: ~6 weeks wall-clock, shipped as five incremental PRs inside the monolith.* Temporal v2 is then a **date-aware overlay**, not a replumb:

### 4.3 Studio v2 — Temporal RAG as an overlay, not a rewrite

Approach (state-of-art `TG-RAG` bi-level temporal graph applied to Lekhan's graph model):

- **Data:** add two nullable cols to `page_chunks` already created — `valid_at, expired_at` (defaults `created_at, null`). Keep immutable parallel edges for same entity pair at different times (e.g., `[[Auth]] → [[Payments]]` relation timestamped) — mirrors `page_links.to_title` timeline already in graph index, now time-scoped.
- **Time hierarchy:** lightweight `time_hierarchy` materialized view (year→quarter→month→day) auto-populated from `valid_at`; cross-layer edges are `chunk.valid_at ↔ time_node`.
- **Agent pipeline:** OpenAI cookbook `Temporal Agent` stages → run as MCP skill inside `studio-worker`: chunk `statement → TemporalType {atemporal,static,dynamic} → TemporalValidityRange → (subject,predicate,object)+valid_at/expired_at → invalidation check (`invalidated_by`)`. Batch incrementally: new docs → extract `temporal quadruples` → merge into `page_chunks` + `time_hierarchy` summaries (only regen affected ancestors — not full re-summarization).
- **Retrieval:** `hybrid_search` gets temporal overload `hybrid_search_temporal(p_workspace_id, p_embedding, p_time_window tstzrange)` → filtered by `@> valid_at` then RRF; second mode "global temporal summary" picks time-node summaries for trend answers (ECT-QA pattern). Citations gain `valid_at` bucket for scroller UX.

**This is one migration + one MCP skill evolution, not a service.** Gate v2 behind the same `studio_jobs` status (`type: temporal-briefing`) so v1 clients ignore it.

### 4.4 Gating criteria for when to actually split

| Signal | Metric | Action |
|---|---|---|
| **Embedder throughput** | `studio-worker` P95 > 2s for embedding or queue backlog > 100 jobs/min for >1 week | Extract **embedder only** as `apps/embedder` (stateless HTTP, `halfvec` in/out), keep `page_chunks` write in monolith (caller owns tx). Not a DB split. |
| **Sync write volume** | Single `pages` insert hot-writes stall hub (mirrors Notion VACUUM signal) — or `page_chunks` exceeds 10 GB per workspace | Shard **persistence** by `workspace_id` into logical shards (Notion 15-per-DB trick), not app. App stays monolith with router `workspace_id → shard`. |
| **Team size** | 3 pizza teams each owning a distinct table set (e.g., Billing vs. Studio vs. Mail) with independent SLAs | Split at the **table seam**, not route seam — per-service owns its tables, contracts versioned (`packages/graph/types.ts` becomes `packages/contracts`). Pre-condition: per-service RLS proven. |
| **Enterprise SSO/audit** | Inproc SSO middleware hurts latency/availability for editor | Extract **control plane** `apps/gateway` (Shogo's AGPL boundary) with own rate-limit/audit log, keep editor + sync collapsed. AGPL there is intentional (clone moat). |
| **Plugin popularity** | 50+ community plugins in registry, ± hostile payload reports | Consider Nitro sandbox hardening (Deno/WASI) only if Worker+iframe CSP is bypassed — keep extension host as utility process (VS Code lesson). Not MFE. |

**Rule:** split a seam only when its **scaling or ownership property falsifies the monolith's cost model** — and split exactly one seam per quarter. Lekhan's first plausible split is **embedder service**, not micro-frontends.

### 4.5 Open-core hygiene checklist (next quarter)

- [ ] Add `docs/LICENSING.md` per-directory map (copy Shogo's table format) + SPDX `license` fields to every `package.json` (pre-publish blocker).
- [ ] Add `scripts/verify-license-isolation.mjs` — bidirectionally check MIT packages never `import`/`dependencies` AGPL paths (run in CI, gate PRs) — per Epicenter/Shogo.
- [ ] Generate SBOM (`anchore/syft` CycloneDX) per release, artifact on `supabase/` image and on tarball — expected by tier-two enterprise buyers from 2027 (EU CRA) and increasingly by US 50k+ ACV deals.
- [ ] Add `GET /api/source` (Commit ↔ zip) and footer "Source" link — trivial §13 compliance; corresponds to graph AGPL section.
- [ ] Document MCP tool allowlist policy (Tier-1 security questionnaire answer: "Yes, AGPL components reviewed; mitigated; SBOM per release").
- [ ] Keep **no CLA** until a paying enterprise explicitly asks for a commercial exception — then introduce minimal CLA scoped to AGPL core.

---

## 5. What to Tell a Skeptical Reader

### "Why not just clone Obsidian's model? It's simpler."

Obsidian's model is locally optimal for a two-person team without collab infrastructure — closed core + unsandboxed plugins gives maximal plugin power per minimal trust machinery. For Lekhan, that tradeoff inverts: you ship **collaboration first** (CRDT, hub, `page_members` roles, future `is_team`), so untrusted `fs` access in a shared workspace is a lateral-movement risk, not just a single-user risk. The sandboxed host is load-bearing. And Obsidian's monetization (Sync/Publish) is still AGPL-protectable — Obsidian just chooses proprietary; Lekhan chooses AGPL to legally enforce the same host-not-rented story obsourians already trust (their vault *is* markdown — `ADR 0003`). Different promise, different license.

### "AGPL will kill enterprise sales."

Enterprise buyers do have AGPL blocklists — that's real (FlowVerify 2026-05). But the blocker is *undocumented* AGPL + transitive leakage, not documented AGPL with a clean boundary. Bitwarden (AGPL core + proprietary enterprise), Grafana, Plausible, Nextcloud all close enterprise deals under AGPL by publishing `LICENSE` per directory + SBOM + commercial exception path. The actual sales killers are *unknown* licenses and opaque self-host stories, not AGPL itself. Lekhan should front-load documentation (per-directory map + SBOM) and keep MIT at the adoption edge — that's the answer to the questionnaire's "do you use copyleft?" question: *"Yes — core hub is AGPL, edge SDK is MIT, SBOM attached, commercial exception available per customer pull."*

### "Isn't MCP just hype? Why not REST?"

REST is the MCP underneath — `app/api/mcp` is HTTP. The value is **tool-contract standardization**: every H3 agent (Sheets formula helper, Mail thread summarizer, Chat graph retriever) and every external automation (Raycast, Claude, Contoso's Excel) calls the same `hybrid_search`/`create_page` tools with the same `workspace_id` scoping. Without MCP you rebuild that per integration (Notion's integration story is N custom API adapters). With MCP it's one allowlist, one RLS pass, one citation validator. That's the "thin pluggable root" — the root is the **tool table**, not a gateway service.

---

## 6. Sources & Lekhan File Pointers

**Lekhan ground truth:** `CONTEXT.md:10`, `supabase/migrations/20260812000000_pages_graph_schema.sql:1` (`workspaces/pages/page_links/page_tags/page_versions/page_members`), `supabase/migrations/20260814000000_sync_page_graph.sql:9` (`sync_page_graph` service_role only), `supabase/migrations/20260817000000_global_search.sql:11` (`pg_trgm` GIN `title/searchable_text/tag/to_title`), `supabase/migrations/20260827220000_sync_hardening_ledger.sql` (2s/10s debounce), `server/graph-index.js:82` (`indexPage` incremental), `server/index.js:65` (`graphIndex.indexPage`), `lib/tier-limits.ts:9` (20 MB / 10 GB / 50 GB), `lib/crypto.ts:29,146` (AES-256-GCM, `encryptDocumentState`), `lib/ai/provider-registry.ts:9`, `lib/ai/catalog.ts:4,94` (12 providers, `HardwareTier`), `lib/ai/client.ts:16` (BYOK proxy `x-ai-api-key` vs local `localhost:11434`), `lib/ai/vault.ts:5` (zero-know vault `profiles.encrypted_ai_keys`), `lib/markdown/engine.ts:142`, `lib/markdown-io.ts`, `lib/export-utils.ts:284,340` (DOCX/pdf pattern), `lib/markdown-export.ts:92,148`, `docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md:3,4,5,6,7,8,40` (one graph many views, §6–8 open-core & plugin sandbox, §13 import pipeline), `docs/roadmap.md` (H0–H3 horizons `#38–#55`, `#78` interop bridge, `#44` plugins v1 → `#51` marketplace), `docs/adr/0001` (E2E Plus toggle, server indexing degraded), `docs/adr/0003/0004` (desktop `*.md` + `.lekhan/` sidecar, merge-on-launch, hub is only cross-device transport), `LICENSE:1,542` (AGPL-3.0 + §7 additional MIT permission), `package.json:5` (license field), `docs/research/2026-08-29-notebooklm-studio-lekhan-feasibility.md:3,4,6,7` (Workspace-root Studio, three seams, v2 temporal overlay).

**Pattern evidence (monolith vs modular examples):**
- Notion: BehindScale "Sharding Postgres at Notion" (480 logical shards / 32→96 physical, `space_id` partition, application-level sharding, audit-log double-write, PgBouncer) (2026-07-09) + DEV/LavX/Potato re-summaries.
- Obsidian: `obsidian.md/license` (proprietary freemium), `forum.obsidian.md` CodeMirror/D3/PIXI stack thread, `obsidianmd/obsidian-api` repo, `help.obsidian.md` plugin guidelines/security ("plugins inherit Obsidian's access; can access files, internet, install programs"), Hacker News plugin security discussion.
- Anytype: `anyproto/any-sync` + `anyproto/anytype-ts` GitHub, `tech.anytype.io/any-sync/overview` (sync/file/consensus/coordinator nodes), DeepWiki anyproto local-first / 30+ Gradle modules.
- AFFiNE: GitHub `toeverything/AFFiNE` monorepo `packages/backend/frontend/common + blocksuite` + `y-octo` Rust via NAPI, `packages/common/nbstore/src/sync/doc/peer.ts:152` (`DocSyncPeer`/`ClockMap`), `packages/backend/native` compaction, mintlify local-first + CRDT docs.
- VS Code: Blog "Migrating VS Code to Process Sandboxing" (2022-11-28), `code.visualstudio.com/api/advanced-topics/extension-host` (local/web/remote hosts, `extensionKind`), DeepWiki extension host + `webWorkerExtensionHostIframe.html` (`v--<sha256>` validation, `event.origin`/`crossOriginIsolated`), arXiv 2411.07479 (ext host unsandboxed critique), plus `webWorkerExtensionHostIframe` CVE fix `236fa7d`.
- Tauri: `v2.tauri.app/develop/sidecar` (`externalBin` + `shell:allow-execute` `sidecar:true` with validator), `ARCHITECTURE.md`, `develop/plugins` (per-plugin `desktop.rs/mobile.rs` + `guest-js`).
- Open-core/licensing: `shogo-ai/docs/LICENSING.md` (AGPL moat vs MIT libraries + `verify-license-isolation` CI), `EpicenterHQ/docs/licensing/licensing-strategy.md` (10 MIT packages + dependency-closure guard `bun run check:licenses`), FlowVerify 2026-05 "Open-source licensing for SaaS" (families table + AGPL network trigger), OSSAlt 2026-03-29 open-core vs source-available + MIT/Apache/AGPL guide, fastCRW 2026-07-04 AGPL for SaaS explainer.
- Temporal RAG: `arxiv 2510.13590` Temporal GraphRAG (bi-level `𝓖_K` temporal KG + `𝓖_T` time hierarchy + `valid_at/invalid_at` + incremental summaries), OpenAI cookbook "Temporal Agents with Knowledge Graphs" (pipeline `statement → TemporalType → TemporalRange → predicate → invalidation`), `github hanjiale/Temporal-GraphRAG`.

---

*Prepared for `/spec` on H3 Studio — the report's claim is that "pluggable root" = **deep host seams (graph + chunks + jobs) + capability-gated plugin/MCP surfaces**, not a service split. Ship those seams, defer services until load or team ownership forces them.*
