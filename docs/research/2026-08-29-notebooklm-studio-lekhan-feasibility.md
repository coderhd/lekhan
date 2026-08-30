# NotebookLM Studio → Lekhan Workspace Studio: Feasibility Research

**Date:** 2026-08-29
**Context:** H3 is concept-not-suite; product is backbone for knowledge base (§ Strategy `docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md:5,40`). User was told advanced Studio is *not* LLM-capability issue but deep arch work (RAG, vector, permissions, offline, citations).
**Question:** What does NotebookLM Studio actually do, what is its architecture, and what is achievable at Lekhan's *Workspace root* (Graph index) given local-first + BYOK/BYOL + Yjs + Supabase + E2E constraints?

---

## 1. NotebookLM Baseline (Gemini Notebook as of July 2026)

> NotebookLM = Gemini Notebook, same product [notebooklm.google](https://notebooklm.google/) · rebrand July 2026.

### 1.1 Corpus model
- **Notebook = isolated silo:** 1 notebook = 1 project corpus. No cross-notebook retrieval. Free tier: 100 notebooks × 50 sources × 500k words / 200 MB per source; enterprise up to 600 sources/notebook [support.google.com/answer/16206866](https://support.google.com/notebooklm/answer/16206866?hl=en).
- **Sources (multimodal, 2026):** PDF, DOCX, TXT, CSV, PNG/JPG/GIF, MP3/MP4/WAV, Google Docs/Sheets/Slides, YouTube URLs, pasted text, web links, EPUB (Mar 2026), MP3 transcription [blog.google 2025-07-29](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-video-overviews-studio-upgrades/) [gearstackd.com review 2026-06-15](https://gearstackd.com/google-notebooklm-review/). Deep Research can *discover* sources via web search then curate into notebook.
- **Static snapshots:** re-upload required if source changes; no live Drive sync (known constraint) [chinwendu.medium.com](https://chinwendu.medium.com/how-notebooklm-handles-file-uploads-8e0f9a34c7ac).

### 1.2 Studio panel = formatter layer over the grounded corpus
From `trinitytuts.com` + `blog.google` + `digital-ocean 2026-02-18`: *"Think of Studio as a formatter layer: it does not hunt new facts, it packages what you already imported."*

| Tile (as of mid-2026) | Output | Customization | Export | Notes |
|---|---|---|---|---|
| **Audio Overview** | 2-host podcast dialog (hosts interpret, debate) | format: deep dive / brief / critique / debate; focus prompt, language (80+ via DeepMind), length, **Interactive mode** (join conversation live) | MP3 in-app, background gen | Viral origin; also Brief/Critique/Debate |
| **Video Overview** | Narrated slides → now **Cinematic** (Veo 3 + Imagen + Nano Banana Pro) | Explainer / Brief / Cinematic / Short (60s); visual styles: Classic, Whiteboard, Watercolor, Retro Print, Kawaii, Anime, etc.; custom prompt | MP4; generation 5–30 min | Classic styles excluded for Cinematic/Short; English-only for Cinematic/Short; highest latency |
| **Mind Map** | Interactive branch/interconnected nodes | auto, editable | PNG/SVG | — |
| **Reports** | Briefing Doc, Study Guide, FAQ + **dynamic AI-suggested formats** (tailored to corpus, not fixed list) | standard chips or dynamic suggestion; per-source selection (checked sources only) | Google Docs / PDF | Suggests bespoke format name + extended name |
| **Data Table** | Sheet-ready structured extraction | — | Sheets / CSV | — |
| **Slide Deck** | Structured deck | detailed deck vs presenter slides, length, language, focus prompt | **PPTX** (new 2026) + Google Slides planned; **Slide Revisions** (regen single slide) | Uses Nano Banana Pro for images |
| **Infographic** | Visual summary | orientation, detail, style: Sketch Note/Kawaii/Anime/Clay vs Professional/Scientific/Editorial/Instructional vs Bento/Bricks | PNG/SVG/JPG/GIF | Uses Nano Banana Pro |
| **Flashcards / Quiz** | Study aids | #cards/questions, difficulty | — | Persistent progress, Got it/Missed, scoring, hints, elaboration |
| **Doc / Sheet / Chart factory** (June 2026 expansion) | PDF reports w/ charts/tables, bespoke worksheets, budget spreadsheets, data viz | instruction-guided | **PDF, DOCX, XLSX, CSV, JSON, MD, TXT, PNG, SVG, JPG** | `blog.google 2026-06-08` — code + analysis + charts inline |

Also: **Notes** editor + ability to *create any artifact from chat* without leaving conversation (Mar 2026).

### 1.3 Underlying architecture (RAG + source grounding)

> Multiple high-quality teardowns converge: hybrid grounding over pure RAG is Google's design.

1. **Upload pipeline (async-first):** browser → blob serialize → Spanner queue + blob store (GCS) → format-specific parsers (OCR, doc conversion, audio transcription) — decoupled sync vs async [chinwendu.medium.com](https://chinwendu.medium.com/how-notebooklm-handles-file-uploads-8e0f9a34c7ac).
2. **Adaptive chunking:** *Not* aggressive 500-token RAG for small corpora. Leverages Gemini 1.5 Pro/2.0 large context (1–2M tokens). Tiered: small/medium notebooks → **inject full documents** into context (no chunking, preserves structure); large corpora → semantic chunking + embeddings [chinwendu.medium.com] [dev.to/jubinsoni 2026-03-10](https://dev.to/jubinsoni/architecting-the-future-of-research-a-technical-deep-dive-into-notebooklm-and-gemini-integration-m60).
3. **Embedding:** Gemini `text-embedding` family, ~768 or 3072 dims, per-chunk dense vectors [chinwendu.medium.com] .
4. **Vector store:** Vertex AI Vector Search (Matching Engine) + Discovery Engine as shared infra; HNSW/ANN nearest-neighbour index [chinwendu.medium.com] .
5. **Query-time retrieval (enhanced retrieval & ranking):** query understanding → multi-angle retrieval (query rewriting, synonym expansion) → top-k cosine similarity → reranking (likely cross-encoder / RRF) → context assembly → grounded generation with **inline citation per claim, clickable to exact passage** [emergentmind.com](https://www.emergentmind.com/topics/notebooklm) [arxiv 2504.09720v2](https://arxiv.org/html/2504.09720v2).
6. **Grounding guarantee:** *Source-grounding* (Steven Johnson) — model instructed to answer only from corpus; every factual assertion cited; reduces hallucination but not zero (citation can still overstate) [digital-humans.org 2026-07-26](https://digital-humans.org/foundation-models/notebooklm-googles-research-ai-deep-dive/).
7. **Job model:** Studio artifacts are async jobs (not in-prompt). Multi-create, listen while browsing mind map, background polling (30 min for video).

**Why it matters for Lekhan:** NotebookLM *centralizes* everything — storage, embeddings, reranking, Gemini inference, Veo/Imagen render — behind Google's bill. No offline, no BYOK, no E2E (model choice locked to Gemini — [gearstackd] "Weak"), and Notebook = single silo, not a living graph.

---

## 2. Lekhan Arch Constraints (ground truth from repo)

### 2.1 Data model: Workspace root is the *one* knowledge graph

From `CONTEXT.md:10` + `docs/adr/*` + `supabase/migrations/20260812000000_pages_graph_schema.sql:1`:

```
Workspaces (id, owner_id, is_team)        ← unit of ownership/billing/collab
  └─ Pages (id, workspace_id, parent_id, title, properties JSONB, searchable_text, is_public)
       ├─ page_links (workspace_id, from_page_id, to_page_id nullable, to_title, block_id reserved NULL)
       ├─ page_tags  (page_id, tag)
       └─ page_versions (history, per-tier retention via lib/tier-limits.ts)
  └─ page_members (page_id, user_id, role enum owner/editor/viewer)
```

- **Graph index** (`server/graph-index.js:82`, `supabase/migrations/20260814000000_sync_page_graph.sql:9`) is *incrementally maintained, transactional, row-locked per page*: JS extracts `[[wikilinks]]` via `MARKDOWN_LINK_RE` + `#tags` + `properties.tags` → `sync_page_graph(p_links/p_tags)` atomically replaces links/tags + updates `searchable_text`. `REVOKE EXECUTE FROM anon,authenticated` → **service_role only**.
- **Search today:** `search_pages(p_query, p_limit)` `SECURITY INVOKER` — rides the graph index, `pg_trgm` GIN on `title/searchable_text/tag/to_title` (`20260817000000_global_search.sql:11`), ILIKE substring with rank (title 4 > tag 3 > link 2 > content 1). Corpus filter after RLS: `owner_id = auth.uid() OR page_members` — **excludes stranger public pages** by design.
- **No vector yet:** grep shows zero `pgvector` / `vector` / `embedding` in migrations — **green-field for chunks table**. Only `pg_trgm` is enabled.
- **Properties as future typed views:** H2 Databases = typed views over `properties` + links; Sheets/Slides are ordered/grid views (Strategy §3). Studio must *write back* as Pages with properties, not as loose files.

### 2.2 Sync & storage: local-first, CRDT-per-page, hub-relayed

- **Per-page Yjs docs** (`yjs@13.6.15`, `y-websocket`, `y-prosemirror`, Tiptap v3) — WAL + `main_state.bin` in Supabase Storage `documents/<id>/main_state.bin` (`server/index.js:65` → `graphIndex.indexPage`), plus per-device replica:
  - Desktop (Tauri, ADR 0003): `*.md` per page (human-visible) + hidden `.lekhan/.lekhan/` sidecar WAL+snapshots → markdown round-trip `tiptap-markdown` + `lib/markdown/engine.ts`/`lib/markdown-io.ts`. **Merge-on-launch** (ADR 0004) CRDT-merges hub → rewrites `.md`.
  - Mobile PWA: `y-indexeddb` (opaque, IndexedDB).
  - Cross-device only via **hub** (y-websocket relay + Storage snapshots). Offline queue + Yjs merge, no conflict copies.
- **Markdown engine:** `markdownEngine.parse/serialize/seedToYjsBase64/plainText` (`lib/markdown/engine.ts:142`). Frontmatter (`title`, `tags`) ↔ `properties`.
- **Export today:** `lib/export-utils.ts:1` (DOCX via `docx@9.7.1` — `buildDocxChildren/buildDocxDocument`, PDF via `jspdf@4.2.1` + `html2canvas@1.4.1`, HTML via `lib/markdown-export.ts:92` `buildStandaloneHtml`) + markdown via `lib/markdown-export.ts:148` `buildMarkdownExport`. **No PPTX/XLSX native** yet (needs `pptxgenjs`/`exceljs` — simple add).
- **Storage limits:** `lib/tier-limits.ts:9` Free 20 MB / Plus 10 GB / Pro 50 GB (plan mirrors `workspaces.owner_id` — ADR 0001).

### 2.3 AI: BYOK/BYOL, never hosted, provider registry

From `lib/ai/provider-registry.ts:9`, `lib/ai/catalog.ts:4`, `lib/ai/types.ts:3`, `lib/ai/client.ts:16`:

- **12 providers:** `ollama | lmstudio | openrouter | gemini | groq | anthropic | openai | deepseek | qwen | zai | sarvam | custom`.
- **Trust model:** `TRUSTED_PROVIDER_BASE_URLS` + `LOCAL_PROVIDERS = {ollama, lmstudio}` (only those allowed `http://localhost`). `isValidCustomUrl` blocks private-net HTTPS. `resolveChatRequest` → cloud → `/api/ai/stream` proxy with `x-ai-api-key`; local → direct `http://localhost:11434/api/chat` (`isLocalDirect:true`). Streaming SSE/NDJSON unified, fallback chain on 429/503.
- **Vault:** `lib/ai/vault.ts:5` + `lib/crypto.ts:29` AES-256-GCM (PBKDF2 100k iterations, IV 12 bytes) — per-provider keys stored encrypted in `profiles.encrypted_ai_keys` via `syncVaultToSupabase`. Zero-knowledge; Lekhan never sees plaintext.
- **Cost safety:** *No Lekhan-hosted inference anywhere* (Strategy §6.3). Free tier = guided free-key on-ramp (OpenRouter free, Gemini free tier, Groq) → user's own quota. **Implication for Studio: we cannot generate audio/video/images on Lekhan's bill. Must delegate to user's BYOK key or local model.**

### 2.4 Permissions & encryption (the hard constraints)

- **RLS via `can_access_page(id)`** (`20260812000000_pages_graph_schema.sql:75`): `owner_id = uid OR is_public OR page_members OR legacy document_members`. All search must be **permission-aware by construction** (`SECURITY INVOKER`).
- **Team path not yet enabled:** `workspaces.is_team false` default; `workspaces UNIQUE(owner_id)` in H0 = one personal workspace per user (schema comment: "one personal vault per owner in H0; team workspaces evolve in H2"). So current RLS = personal + explicit page_members, not workspace-role.
- **E2E per-workspace (Plus, ADR 0001):** opt-in AES-256-GCM client-held keys (`lib/crypto.ts:146 encryptDocumentState`). Tradeoff: **no server-side `searchable_text` / `page_links` / `page_tags` extraction** until client-side indexing ships → server RAG is **degraded to local replica** for E2E workspaces. Studio for E2E must be either local-only (WASM embeddings + IndexedDB) or explicitly warn that E2E is incompatible with server Studio until H1 client index lands.

### 2.5 Offline + versioning

- `lib/version-history/*` + `lib/tier-limits.ts:10` Free 1 day / Plus 90 / Pro 365 — Git-style milestones, word diff. Offline = full edit, reconnect CRDT merge. **Any Studio vector index must be incremental and tolerate offline edits queuing in sidecar WAL**, not a batch rebuild.

---

## 3. LLM-Trivial vs Architecture-Deep: Where the Work Really Is

**Rule of thumb for Lekhan:** if it can be done by *concatenating `search_pages` top hits into a prompt and calling the user's current model*, it's LLM-trivial. If it needs *new tables, background jobs, incremental indexing, permission-aware vector search, or renderers that survive BYOK/BYOL + offline + citations*, it's deep.

### 3.1 LLM-trivial (prompt engineering only — ships in days, reuses graph index + AIClient)

- Short synthesis over a *small* workspace that fits context: briefing doc, FAQ, study guide, epic/story templating from a handful of meeting notes. Just `search_pages(query, 15)` → concatenate `title + searchable_text` → prompt template.
- Dynamic report *format suggestion*: prompt the LLM with source titles/tags → return JSON `[{name, extendedName}]` (mirrors NotebookLM dynamic reports `lilys.ai 2026-01-13`).
- Simple quiz/flashcards over 1–5 selected pages (full text fits). No retrieval needed, inline citations optional (`→ [[Page Title]]` is free — page IDs are known).
- Rephrase / simplify / translate a page (page-level, not graph-root — existing Bot bar does this).

### 3.2 Architecture-deep (vector + graph + offline + citations + export — the real H3 work)

| Concern | Why it's deep for Lekhan | NotebookLM's shortcut |
|---|---|---|
| **Workspace-level RAG (Workspace RAG = retrieval over whole graph)** | Need **chunks table + embeddings + incremental updater**. NotebookLM can stuff 50 docs into Gemini 2M window; Lekhan workspaces can be 500 pages × 10k chars = far beyond even 2M. Must chunk (Yjs plainText → ~800-token chunks, 150 overlap), embed, index. | Centralized embedding + Vertex AI Vector Search, no local-first cost |
| **Permission-aware retrieval** | Vector search must **join/filter by `can_access_page`** before returning vectors. Cannot leak embedding of private pages to embeddings endpoint. Requires `chunks(workspace_id, page_id, tenant_id, ordinal, content, embedding halfvec, token_count)` with **RLS + `workspace_id` denorm** (Supabase hybrid-search pattern `suparbase.com Hybrid search` / `supabase.com/docs/guides/ai/hybrid-search`). | Single-tenant notebook, no RLS |
| **Incremental graph-aware indexing** | `server/graph-index.js:indexPage` currently extracts only links/tags/searchable_text. Must add **chunking + embedding** debounced 2s/10s (same cadence as sync hardening ledger `20260827220000_sync_hardening_ledger.sql`). On every Yjs save + on `indexPages` batch import, update chunks atomically. Need model column + re-embed on model switch. | Spanner queue + blob store, no CRDT merge |
| **Hybrid search (lexical + vector + graph)** | Best recall = lexical (`pg_trgm` / `tsvector`) + vector (`pgvector` cosine) fused by **RRF** (`supabase hybrid_search(p_query, p_embedding)` recipe). Plus graph metadata filters: `where tag = X` or `where link.to_title = Y` (e.g., "only specs linking to [[Roadmap]]"). Needs unified rank function. | NotebookLM does multi-angle retrieval but not graph-aware |
| **Citations to page/block with verification** | NotebookLM cites passage → scroll. Lekhan citations must resolve to **page_id + chunk ordinal + optional wikilink/block_id** and render clickable `[[Title]]` → live page. Needs `chunks(page_id, ordinal)` + citation validator (check returned chunk still exists / not stale). | Trivial (static chunks) |
| **Offline + E2E embeddings** | Default server embeddings (OpenAI/Gemini via BYOK) fail for E2E (server can't see plaintext) and offline. Need **client-side WASM embeddings** as fallback (e.g., `nomic-embed-text` via `transformers.js` + `all-MiniLM` 384 dims) stored in IndexedDB/sidecar `chunks` mirror, with Tauri `.lekhan/embeddings/` cache. Model choice must respect BYOL catalog tiers `HardwareTier light/medium/heavy` (`lib/ai/catalog.ts:94`). | No offline; no E2E (Google sees all) |
| **Export to office formats** | Markdown/HTML/DOCX/PDF already via `export-utils.ts` (`docx`, `jspdf`, `html2canvas`). **PPTX/XLSX not yet** — needs `pptxgenjs` (client-side, zero server) + `exceljs` / `xlsx` worker. Charts need `chart.js` → canvas → image. Artifact download vs "create new pages" choice. | Exports via Drive (Google servers render) |
| **Synthetic media (audio/video/infographic)** | NB uses Veo+Imagen+Nano Banana on Google's bill. Lekhan cannot. Achievable substitute = **script → TTS** pipeline: LLM generates dialog script (trivial) → user BYOK TTS (ElevenLabs, OpenAI TTS, Gemini TTS at `generativelanguage.googleapis.com`) **or** local `piper` / `coqui`. Rendering must be **async job queue** (Supabase Queue / `pg_cron` or client Web Worker) — e.g., 3-min podcast = minutes; video = even longer. Storage = Supabase Storage `studio_artifacts/<workspace>/<job>/`. Video overview *as Veo cinematic* is effectively **not achievable** without hosted inference; nearest achievable = narrated slide-deck video (reveal.js + TTS + canvas capture). | Hosted Veo/Imagen — minutes but server-side |
| **Studio job queue + permissions** | Multi-create artifacts in one workspace (like NotebookLM's 4 tiles) needs **job table** `studio_jobs(workspace_id, type, status, input_sources, model, output_uri)` + polling + cancel + revisions (Slide Revisions pattern). Must enforce workspace-level RBAC + quota (tier limits). | Background Studio jobs already (Spanner) |
| **Source discovery / Deep Research** | NotebookLM web search → sources. Lekhan has no crawler. Team use case ("generate epics from Confluence") is **import pipeline reuse**, not search — `#27` Obsidian importer + `#45` Notion importer `intermediate representation (pages + blocks + properties + links)`. So "import as RAG ingestion" already scoped. | Discovery Engine + web search |

---

## 4. Achievable Studio Output Matrix for Lekhan (at Workspace root)

> One knowledge graph, many views (Strategy §3, §4). Studio = *generative views* that either **write new Pages back into the graph** (Wikilink-addressable, tag-filterable) or **export artifacts** (downloadable, not nodes). This distinction determines RLS/citations/offline story.

### 4.1 Group 1 — Graph-native (new Pages with properties, links, tags)

*The H3 wedge for teams replacing Confluence. These are **views as data**, not files.*

| # | Output type | Example (team) | Example (personal) | LLM vs Arch | Reuse vs New |
|---|---|---|---|---|---|
| **G1-1** | **Epic / User Story generator** | Select 12 meeting-note pages + PRD pages → "Generate 8 epics with acceptance criteria as child pages under [[Q3 Roadmap]] with properties `{status: draft, priority: P1, estimate: M}` and links to source pages" | Vault synthesis ("turn my [[ideas]] into 5 actionable projects") | LLM generation is trivial *once RAG gives the right slices*; **arch: needs RAG + page creation tx + properties schema** | **Reuse:** `pages` insert + `properties JSONB`, `page_links` via `[[title]]` in body, `page_tags` auto, `sync_page_graph`. **New:** prompt template + bulk `pages.insert` RPC + citation footer |
| **G1-2** | **Structured Briefing Doc / RFC summary as Page** | "Briefing doc for execs: synthesize [[Sprint Retro Nov]] + [[Incidents]] — risks, decisions, citations per bullet → new page [[Brief 2026-11-29]]" | Student: briefing doc for exam from lecture pages | LLM trivial (with RAG); arch: citation rendering + auto-tag | Reuse graph index + AIClient. New: chunk retrieval, inline citation component `[[Title §chunk]]` |
| **G1-3** | **Table view as typed pages (Data Table → Pages)** | "Extract action items to table with columns {owner, due, status, source}" → creates child pages per row (basis for future H2 Databases `#47` as typed views) | Reading list → table of papers with `{venue, year, key finding}` | LLM extract JSON trivial; arch: **needs schema inference + properties validation** | New: `properties` typed mapper; reuse: H2 DB substrate (preview). Export optional CSV |
| **G1-4** | **Mind map as linked page cluster** | "Mind map of [[Architecture]] graph — central [[Auth]] with spokes to dependents, color by tag `service`" | Thesis mind map | LLM trivial for small graph; **arch for large graph: needs graph-aware retrieval (page_links join), not just semantic search** | **Reuse:** `page_links` index already. New: graph-traversal query `SELECT * FROM page_links WHERE workspace_id = $1`, layout via `markmap`/`cytoscape` → either ephemeral view or serialized as page with mermaid block |

> **Achievability: HIGH — pure Lekhan graph, no Veo. Fits BYOK/BYOL, offline (chunks local), citations → [[Page]] backlink. Best H3 wedge.**

### 4.2 Group 2 — Learning (read-only, on-graph, no heavy render)

| # | Output type | LLM vs Arch | Reuse vs New |
|---|---|---|---|
| **L1** | **Quiz / Flashcards** (grouped per workspace) | LLM generates Q&A from retrieved chunks trivially; customize deck by difficulty/count | Reuse: prompt + `search_pages` for small decks. New: **chunk retrieval + answer-grounding validator** (check answer span exists in chunk) + progress persistence `studio_progress(workspace_id,user_id,type,state)` like NB persistent progress Mar 2026 |
| **L2** | **Study Guide / FAQ** | Trivial template over RAG | Same as G1-2 — reuse. Pagination trivial |
| **L3** | **Reports with charts** | LLM can write analysis; **arch: chart data needs structured extraction → chart renderer**. If charts are derived from `properties` numeric fields, trivial; if from prose tables, needs table extraction (deep) | Reuse: existing markdown callouts (`lib/callout.ts`). New: chart block type → `chart.js` → canvas image for exports |

> **Achievability: HIGH.** Best for personal vault wedge ("memorize CLI flags" pattern from `trinitytuts.com`). All client-side after retrieval.

### 4.3 Group 3 — Office artifacts (exports, not graph nodes)

*Company using Lekhan instead of Confluence → PM wants PPT/Excel/Doc. These are **downloads**, not Pages.*

| # | Output type | What it reuses | What must be built | BYOK/BYOL note |
|---|---|---|---|---|
| **O1** | **Slides (PPTX)** | `export-utils.ts` docx/pdf pattern is precedent for client-side artifact generation. LLM generates deck JSON `{slides:[{title,bullets,layout,notes}]}` — trivial. | **New:** `pptxgenjs` (pure JS, no server) installed alongside `docx`. Renderer maps blocks → `pptxgenjs` shapes; image generation via separate LLM image call **only if user supplies key** (else placeholder). Need slide-revision loop (single-slide regen). | Fully feasible. Client-side after LLM gives JSON — survives offline once JSON cached. |
| **O2** | **Spreadsheet (XLSX)** | Same: LLM JSON rows → sheet | **New:** `exceljs` or `xlsx` in Web Worker (heavy). Add `export-utils.ts:exportToXlsx(json, title)` parallel to `exportToDocx`. Need column type inference. | Feasible, lightweight arch. |
| **O3** | **Document export (DOCX/PDF/HTML/MD)** | **Already shipped** (`export-utils.ts:284 exportToDocx`, `:340 exportToPdf`, markdown-export.ts:148). Studio just needs to **write the generated report to a temp Yjs doc then call existing exporter**. | Minor: progress wrapper + studio artifact storage (ephemeral page vs file). | Trivial - glue code. |
| **O4** | **Data visual as image/chart export (PNG/SVG)** | `html2canvas` already in PDF path; chart via `chart.js` → canvas → `toDataURL`. | New: chart spec JSON from LLM → render → `downloadBlob` | Feasible. |

> **Achievability: HIGH — reuse export seam, add two deps. PM's "PPT/Excel/Doc" is straightforward; "Doc" already done.**

### 4.4 Group 4 — Synthetic media (where Lekhan diverges from NB by necessity)

| # | Output type | Naive LLM part | Deep arch part (the real cost) | Verdict for Lekhan |
|---|---|---|---|---|
| **S1** | **Audio Overview / Podcast** | LLM writes 2-host dialog script with focus/length/format (deep dive/brief/critique/debate) — **trivial** (NB quality prompt is one-shot). | **TTS rendering:** need BYOK TTS provider (OpenAI `tts-1`, ElevenLabs, Gemini TTS at `generativelanguage.googleapis.com`) or **BYOL local TTS** (Piper/Coqui via Ollama-compatible endpoint or WASM). Batch: LLM → split utterances → per-host voice → `ffmpeg.wasm` stitch → MP3. **Job queue:** async (minutes) → Storage upload. Interactive mode = second prompt turn (trivial) + streaming TTS (deep). | **Achievable with BYOK/BYOL + job queue.** Quality will trail NB's studio-grade voices unless user brings good key. Offer *script-only* fallback when no TTS key. |
| **S2** | **Video Overview** (narrated slides) | LLM writes slide script + per-slide narration + image prompts — trivial. | **Render:** if staying within Lekhan promises, generate PPTX via O1 → add TTS audio per slide (S1) → capture slides as images (`html2canvas`) → compose MP4 via `ffmpeg.wasm` or Tauri FFmpeg sidecar. **Cinematic Veo path (animated, fluid storytelling) is NOT achievable** without hosted Veo/Imagen — violates never-hosted principle; even if proxied via BYOK Gemini key, Veo pricing/latency makes it a non-starter for free tier. | **Achievable only as "narrated slide-deck video" (NB's pre-cinematic tier).** Call it *Slidecast* not *Cinematic* to set expectations. Cinematic = deferred + requires explicit paid Gemini key + Veo enablement. |
| **S3** | **Infographic** | LLM outputs layout JSON (sections, hierarchy, data points) or mermaid/HTML — trivial. | **Render:** if image model available via BYOK (`Nano Banana Pro` / Imagen via Gemini key), call it; else **client-side SVG/HTML** → `html2canvas` → PNG/SVG. Styles (Bento, Bricks, Professional) = template CSS variants, not model-specific. | **Achievable as HTML→Image.** Image-gen-enhanced infographic only with user's Gemini key. |
| **S4** | **Mind map image export** | LLM outputs node JSON | Render via `markmap`/`cytoscape` → PNG/SVG (same as G1-4 view) | Achievable, no heavy arch. |

> **Achievability: CONDITIONAL — script generation is LLM-free; rendering needs BYOK TTS/image or local models + job infra. Must be honest: "Audio/slidecast feasible day-1 with your key; cinematic video is a second horizon that even Google gates to 18+ & paid tiers."**

---

## 5. Detailed Achievable Matrix (Output type | LLM vs Arch work | Reuse vs New)

| Output | Group | Capability | LLM-trivial? | Deep arch needed | Reuses existing | New infra |
|---|---|---|---|---|---|---|
| **Epics/Stories as Pages** | Graph-native | Workspace RAG → pages with `properties` + `[[links]]` | ● generation | **Yes** — chunks+vectors, permission-aware RAG, bulk page tx | `pages/pages_links/page_tags` schema, `sync_page_graph`, `markdown-io` | `chunks` table + `pgvector` + incremental embedder + `studio_jobs` |
| **Briefing Doc as Page** | Graph-native | 1-page synthesis with per-bullet citations | ● with RAG | Yes — citations → page/block | search_pages + AIClient | chunk citation resolver + UI |
| **Data Table → typed pages** | Graph-native | Extract rows → create pages with properties | ● JSON extract | **Yes** — schema inference | `properties JSONB` (H2 precursor) | typed property validator + optional CSV/XLSX export |
| **Mind map (graph view)** | Graph-native | Interactive branches over `page_links` | — (graph, not LLM) | Light — graph query + layout | `page_links` index (`page_links_workspace_idx`) + `extractLinks` | cytoscape/markmap component |
| **Quiz / Flashcards** | Learning | Q&A + hints + scoring | ● prompt | Light — grounding validator + progress | AIClient | `studio_progress` + rerun Got it/Missed |
| **Study guide / FAQ** | Learning | Longform synthesis | ● prompt | No beyond RAG | AIClient | — |
| **Report + charts** | Learning | Analysis + data viz | ● text; ○ chart extraction | Medium — chart spec → render | `lib/callout.ts`, `html2canvas` | chart.js block + canvas export |
| **Slide Deck PPTX** | Office | Deck JSON → PPTX | ● JSON | Medium — renderer + revisions | `export-utils.ts` docx pattern | `pptxgenjs` + `StudioRenderer` + single-slide regen endpoint |
| **Spreadsheet XLSX** | Office | Rows → XLSX | ● JSON | Light — worker | — | `exceljs` + `exportToXlsx` |
| **Document (DOCX/PDF/MD)** | Office | Report → export | ● | None | `exportToDocx/exportToPdf/buildMarkdownExport` | Glue only |
| **Audio podcast** | Synthetic | Dialog script | ● script | **Yes** — TTS + job + Storage | AIClient (script) | BYOK TTS adapter + pg queue + `ffmpeg.wasm` + `studio_artifacts` bucket + interactive second turn |
| **Narrated slide video** | Synthetic | Script + narration | ● script | **Yes** — PPTX render + TTS + MP4 stitch | pptxgenjs + TTS adapter | ffmpeg mux (+ Tauri sidecar for perf) |
| **Cinematic video** | Synthetic | Story + visual prompts | ● prompts | **Deep Veo/Imagen** (hosted) | — | Veo via Gemini BYOK (optional, not H3 wedge) |
| **Infographic** | Synthetic | Layout spec / image prompt | ● layout; ○ image prompt | Medium — HTML→PNG or BYOK image | `html2canvas` | style templates + optional Imagen via BYOK |

**Legend:** ● = prompt only · ○ = trivial + light post-processing · **Yes** = weeks-level engineering.

---

## 6. Recommended H3 Wedge Use Cases

### 6.1 Which surfaces justify the Studio?

H3's Strategy §4 positions Databases (`#47`) as the next horizon, but **interop bridge `#78`** ("Dual-Dialect Interop Bridge") unblocks vendor lock-in reversal — the team's Confluence pain is real, and PM PPT/Excel/Doc request is the canary.

### 6.2 For team knowledge base (replace Confluence)

> One graph, many views. Team workspace = shared graph with `page_members` roles (editor/viewer) + future `workspaces.is_team`.

| Wedge | Why it wins here | Studio output | Success signal |
|---|---|---|---|
| **Epics & Stories from scattered notes** | Teams live in meeting pages, PRDs, retro notes, tickets as `[[links]]`. "Generate epics" is **read-many → write-many** that NB can't do (NB only generates *reports*, not graph mutations). Lekhan can create *Pages as epics* with `properties` → immediately usable as board rows when H2 Databases ships. | G1-1 (Graph-native, writes back) | PM runs 12 pages → 8 epics in 20s, each with citations to source pages, editable as real pages |
| **Briefing Doc for async reviews** | Execs drowning in poorly-structured info (NB's own pitch). Team brief with inline citations to source pages is defensible. | G1-2 → optionally O3 (DOCX/PDF export for share) | Brief exports to PDF, each bullet cites `[[Sprint]]` |
| **Changelog / Release notes from commit pages** | Graph tags (`#release`) filter → synthesize | G1-2 | Filtered Studio job: `tags: release AND links: [[Auth]]` |
| **Deck/Sheet for stakeholders** | Board wants PPT, Finance wants Excel — exactly the request. Producible from graph without leaving Lekhan. | O1/O2 + G1-3 | One-click "briefing doc → deck + sheet" |

> **Stage the promise:** G1+O1/O2/O3 is the H3 MVP (2–3 weeks of arch + renderer after vector groundwork). Synthetic audio/video is **H3.5** — nice to have, not wedge-critical for teams.

### 6.3 For personal vault (Obsidian personal brain + Notion collab)

| Wedge | Why it wins here | Studio output |
|---|---|---|
| **Commute-learning:** podcast from lecture pages / book notes | Personal vault = long notes, highlights, `#tag` clusters | S1 (script → local TTS) — *privacy win: local TTS never leaves device* |
| **Concept map:** mind map over my thesis | Graph view depth (H1 #38) but generative | G1-4 (interactive) + export PNG |
| **Active recall:** flashcards/quiz over exam pages | Proven learning loop, NB's strongest personal pattern | L1 with persistent progress |
| **Infographic for sharing:** visual summary of research | Single-page artifact to share externally | S3 (HTML→image, BYOK image model comes later) |

---

## 7. Minimal Architecture to Unblock Studio (what to build, in order)

**Order respects "not LLM capability" — build the boring incremental store first.**

1. **Chunk layer + vector store (enables everything else)**
   - Migration: `CREATE EXTENSION IF NOT EXISTS vector` + `CREATE TABLE page_chunks(id uuid, workspace_id uuid, page_id uuid REFERENCES pages(id) ON DELETE CASCADE, ordinal int, content text, embedding halfvec(768), token_count int, model text, updated_at timestamptz, UNIQUE(page_id, ordinal))` + HNSW index `USING hnsw (embedding halfvec_cosine_ops)` + GIN `content gin_trgm_ops` (or `tsvector`). Denorm `workspace_id` for RLS speed. Seed model `nomic-embed-text` (768 dims, `lib/ai/catalog.ts` already has `all-MiniLM 384` fallback for light tier).
   - Server: extend `server/graph-index.js:indexPage` → also call `chunkAndEmbed(plainText)` (debounced 2s/10s like sync ledger) → batched via `indexPages`. Store via `service_role`. Choose embedding provider by workspace setting: default Gemini `text-embedding-004` via user's key (zero Lekhan cost) or local Ollama `nomic-embed-text` when workspace is E2E/offline. Add `pg_trgm + vector` hybrid search function `hybrid_search(p_workspace_id, p_query, p_embedding, p_tag_filter, p_link_filter)` → RRF fusion (recipe `supabase.com/docs/guides/ai/hybrid-search` / `suparbase.com Hybrid`). **Permission filter must run before vector top-k** — `WHERE page_id IN (SELECT can_access_page)` or `WHERE workspace_id = $1 AND workspace_id` join.

2. **Studio job queue (async, like NB's background artifacts)**
   - Table `studio_jobs(id uuid, workspace_id uuid, user_id uuid, type text, status text, input jsonb, output_uri text, citations jsonb, created_at)` + Supabase Storage `studio_artifacts` bucket (access via `can_access_page`-style helper). Edge function `studio-worker` polls `pending` → calls `hybrid_search` → assembles prompt → streams via BYOK model → fetches citation chunks → writes artifact (page insert or storage file). Supports multi-create (4 tiles) + cancel + progress.

3. **Graph-native writer (the differentiator not in NB)**
   - RPC `studio_create_pages(workspace_id, parent_id, pages jsonb)` — transactional bulk insert into `pages` + `page_links` via `sync_page_graph` loop, returns IDs for citation wiring. Pages get `properties` typed by Studio output (epic schema). All writes go through RLS (owner_id = uid).

4. **Office renderers (client-side, zero server render)**
   - `lib/studio/renderers.ts`: `renderDeck(json) → pptxgenjs`, `renderSheet(json) → exceljs`, reuse `export-utils.ts:284` DOCX/PDF path. Add `pptxgenjs@3` + `exceljs@4` as parallel deps to `docx/jspdf` (already client-side, no hosted). Charts via `chart.js` → canvas → PNG embed.

5. **Synthetic media (staged — only after 1–4)**
   - Adapter `lib/ai/tts-provider.ts` mirroring `provider-registry.ts` pattern: `TTSProviderType = 'openai'|'elevenlabs'|'gemini-tts'|'local-piper'`. Script job splits diarized script → per-utterance TTS → `ffmpeg.wasm` (web) / `ffmpeg` sidecar (Tauri) mux → MP3/MP4. Store in Storage. Infographic via HTML template → canvas snapshot; optional `image-gen` adapter if Gemini key present.

6. **Client-side fallback for E2E / offline**
   - WASM embeddings (`transformers.js` `Xenova/nomic-embed-text` or `all-MiniLM-L6-v2` 384 dims) + IndexedDB `chunks` mirror (+ Tauri `.lekhan/embeddings/`). Search via `hnswlib-wasm` or brute-force for <1k chunks. Feature-gate: E2E workspace shows "Studio (local)" badge; degrade gracefully to `search_pages` trigram fallback if worker unavailable.

> **Do NOT build a custom vector DB.** Supabase `pgvector` HNSW is the NB "Vertex AI Vector Search" analog, with hybrid lexical already in the stack (`pg_trgm`). It survives the local-first story because embeddings are per-workspace and cost lives on user's key — same as AI provider registry.

---

## 8. What to Promise vs Defer (for brainstorming)

**Promise in H3 Studio v1 (backbone knowledge base, team wedge):**
- Workspace-root selection ("Generate from: all pages / tag `roadmap` / linking to `[[Auth]]` / checked pages") — graph-filterable corpus, not blind semantic only.
- G1 (epics/stories/briefing/table) as *new Pages* — cites source pages per chunk (clickable `[[Title]]`), editable as native pages, instantly typed-view ready.
- L1/L2 quiz/flashcards/study guide (learning).
- O1/O2/O3 slides/sheets/docs exports (pptxgenjs/exceljs + existing docx/pdf) — the PM PPT/Excel/Doc request, solved without Veo.
- Mind map *view* (interactive) + image export.

**Promise with user's key (BYOK tier):**
- S1 audio dialog script → TTS MP3 when TTS key supplied (else script-only, still useful as "podcast transcript").
- S3 infographic with image model when Gemini key supplied (else HTML→PNG).

**Defer:**
- Cinematic video (Veo 3 + Nano Banana cinematic, 10–30 min, 18+ gate) — present as "slidecast video" v1 instead; gate cinematic behind explicit "use my Gemini/Veo key" toggle once Veo BYOK adapter exists.
- Live cross-device collaborative Studio co-editing (single generation per workspace per type is enough v1 — NB itself only recently unlocked multi-output per type `blog.google 2025-07-29`).
- Audio Interactive mode (join live) — second turn after v1.

**Honest tradeoff for E2E workspaces (ADR 0001):** Studio falls back to local embeddings + local TTS or script-only. Server RAG + server TTS disabled while client index not shipped — must surface at toggle time as part of parity matrix, not as surprise.

---

## 9. Sources & File Pointers (for spec pass)

- Lekhan backbone: `CONTEXT.md:10`, `supabase/migrations/20260812000000_pages_graph_schema.sql:1`, `supabase/migrations/20260814000000_sync_page_graph.sql:9`, `server/graph-index.js:82`, `supabase/migrations/20260817000000_global_search.sql:11`, `lib/export-utils.ts:1`, `lib/markdown-export.ts:92`, `lib/ai/provider-registry.ts:9`, `lib/ai/catalog.ts:4`, `lib/ai/types.ts:3`, `lib/ai/client.ts:16`, `lib/crypto.ts:29`, `lib/ai/vault.ts:5`, `lib/tier-limits.ts:9`, `docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md:40`
- NB baseline & Studio tiles: `notebooklm.google` (Audio/Video), `blog.google 2025-07-29` (Video Overviews + Studio multi-output), `digital-ocean 2026-02-18` (full tile list), `support.google.com/answer/16454555` (Video formats), `support.google.com/answer/16206866` (limits 50/500k/100 notebooks)
- Architecture teardowns: `chinwendu.medium.com` (6-stage pipeline, adaptive chunking, Spanner queue, Vertex AI), `dev.to/jubinsoni 2026-03-10` (MoE, source grounding), `emergentmind.com` (chunk ~hundreds tokens, cosine RAG), `arxiv 2504.09720v2` (RAG tutor / cited pipeline), `digital-humans.org 2026-07-26` (grounded workspace vs chat)
- Studio 2026 expansions: `blog.google 2026-06-08` (charts/xlsx/pptx factory, code), `lilys.ai 2026-01-13` (dynamic reports), `bibigpt.co` (3-column layout Apr 2026), `chromeunboxed.com 2026-03-23` (Cinematic + Nano Banana + Slide Revisions)
- Hybrid RAG for Supabase: `supabase.com/docs/guides/ai/hybrid-search` (tsvector + pgvector RRF), `suparbase.com Hybrid` (chunks schema, HNSW), `markaicode.com` (Ollama + pgvector, `halfvec`, HNSW `m=16 ef=200`)

---

*Prepared for `/brainstorm` — the report's claim is that Studio's cost is *architectural* (permissions, incremental vectors, offline/E2E, job queue, citations, office renderers) far more than *LLM quality* — exactly the user's prior-note.* 
