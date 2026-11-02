# H3 Studio — Deep RAG + Agentic Track — Design

**Date:** 2026-11-02
**Status:** Ready for build (owner-approved scope; phases A–E below)
**Supersedes:** the "thin v1 first / deep v2 parked" sequencing in `2026-08-30-h3-studio-thin-v1-temporal-v2-design.md` §4
**Decision record:** `docs/decisions/h3-studio/08-deep-rag-first-embedder-and-eval-stack.md`
**Related:** `04-retrieval-architecture-plan.md`, `03-generation-writes-pages-export-is-free.md`, `01-one-architecture-not-team-vs-individual.md`, `CONTEXT.md`, ADR 0001 (encryption), ADR 0006 (local-first reads)

## 0. Summary

Studio becomes a **retrieval system over the live knowledge graph**, not a prompt that concatenates pages. Five layers, built in order, each independently demonstrable:

1. **Ingestion & chunking** — block-aware chunks with stable IDs and content hashes.
2. **Embeddings + vector store** — pluggable `Embedder`, server-side `pgvector` (`halfvec(1536)`).
3. **Hybrid retrieval + citations** — vector + lexical (`pg_trgm`, shipped) fused with RRF, link-graph expansion, two-tier page→chunk narrowing, optional rerank, citations that resolve to a page **and** a block.
4. **Agentic layer** — typed tools over the graph (`search_knowledge`, `get_page`, `graph_traverse`, `create_page`), a bounded planner→executor loop, traces, budgets.
5. **Evaluation & observability** — Python `evals/` harness producing recall/MRR/nDCG, citation precision/recall, answer faithfulness, agent task success, cost and latency, with every report committed to `evals/reports/`.

Studio's write-back stays graph-native: generation produces `Page`s with `[[cite]]` links and typed `properties` (`03`). Office artifacts remain renderers over those pages.

## 1. Goals / non-goals

**Goals**

- Answer questions over a workspace with citations that a reviewer can click and verify (`page_id` + `block_id`).
- Retrieval quality that is **measured and regresses loudly** — a CI job that fails when recall drops.
- Agentic tool use that is bounded, observable, and replayable from traces.
- An MCP surface so external clients (Claude Desktop, Cursor, VS Code) can query the graph under the user's permissions.
- Stay inside the existing substrate: `provider-registry` for models, encrypted vault for keys, `can_access_page()` for authorisation, `sync_page_graph` for writes.

**Non-goals (explicit)**

- Fine-tuning or training models. All learning is retrieval-side (embeddings, rerank prompts, eval-driven tuning).
- A separate vector database service. `pgvector` in Supabase is the store.
- Multi-tenant agent orchestration / queues beyond `studio_jobs`.
- Browser-side embeddings.
- Conversation memory across sessions (deferred; the agent is stateless per job except for its trace).

## 2. Architecture

```mermaid
flowchart TB
  Page[Page doc<br/>Tiptap JSON] -->|chunk by block| Chunks[page_chunks<br/>chunk_ordinal, block_id<br/>content_hash, tsv]
  Page -->|summary| Sum[page_summaries]
  Chunks -->|Embedder| Vec[embedding halfvec 1536<br/>HNSW cosine]
  Q[User query / agent tool call] --> QE[embedQuery]
  QE --> Hybrid[hybrid_search_chunks<br/>vector + tsv RRF]
  Q --> Lex[search_pages<br/>pg_trgm, shipped]
  Hybrid --> Expand[link-graph expansion<br/>page_links in/out]
  Lex --> Expand
  Expand --> Rerank{rerank?}
  Rerank -->|yes| RR[LLM rerank top-20]
  Rerank -->|no| Ctx[Context assembly<br/>budgeted tokens]
  RR --> Ctx
  Ctx --> Gen[Generation / agent step]
  Gen --> Cites[Citations: page_id + block_id]
  Cites --> Write[studio_create_pages<br/>Page + [[cite]]]
  Gen -.-> Trace[agent_traces<br/>steps, tools, tokens, cost]
```

**Every retrieval path is RLS-scoped**: SQL functions are `SECURITY INVOKER`, so a caller only ever sees pages they can read. Link-graph expansion re-checks readability rather than trusting `page_links`.

## 3. Data model

Migration: `supabase/migrations/20261102000000_studio_rag.sql`

```sql
create extension if not exists vector;

-- Chunk/summary rows must belong to the page's own workspace. `id` alone is
-- already unique, but a composite key is required for the child FKs below.
alter table public.pages
  add constraint pages_id_workspace_id_key unique (id, workspace_id);

-- One row per retrievable block-run. Re-indexed only when content_hash changes.
create table public.page_chunks (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  chunk_ordinal  integer not null,
  block_id       text not null,              -- stable within a page: ordinal + content hash
  heading_path   text[] not null default '{}',
  content        text not null,
  token_count    integer not null,
  content_hash   text not null,              -- sha256(normalized content + heading_path)
  embedding      halfvec(1536),
  embedding_model text,                      -- 'openai:text-embedding-3-small'
  tsv            tsvector generated always as (to_tsvector('english', content)) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (page_id, chunk_ordinal),
  foreign key (page_id, workspace_id)
    references public.pages (id, workspace_id) on delete cascade on update cascade
);

create index page_chunks_workspace_idx on public.page_chunks (workspace_id, page_id);
create index page_chunks_tsv_idx on public.page_chunks using gin (tsv);
create index page_chunks_embedding_idx on public.page_chunks
  using hnsw (embedding halfvec_cosine_ops) where embedding is not null;

-- One summary embedding per page: narrows candidates before chunk scoring.
create table public.page_summaries (
  page_id          uuid primary key,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  summary          text not null,
  content_hash     text not null,
  embedding        halfvec(1536),
  embedding_model  text,
  updated_at       timestamptz not null default now(),
  foreign key (page_id, workspace_id)
    references public.pages (id, workspace_id) on delete cascade on update cascade
);

create index page_summaries_embedding_idx on public.page_summaries
  using hnsw (embedding halfvec_cosine_ops) where embedding is not null;

-- Agent / Studio runs. One row per job; steps live in JSONB.
create table public.studio_jobs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  created_by    uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('briefing','quiz','agent_research','changelog')),
  status        text not null default 'queued'
                check (status in ('queued','running','succeeded','failed','cancelled')),
  input         jsonb not null,
  output        jsonb,
  error         text,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  cost_usd      numeric(10,6) not null default 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index studio_jobs_workspace_created_idx on public.studio_jobs (workspace_id, created_at desc);
```

Retrieval function (single round trip, fused):

```sql
create or replace function public.hybrid_search_chunks(
  p_workspace_id uuid,
  p_query text,
  p_query_embedding halfvec(1536) default null,
  p_limit integer default 20,
  p_rrf_k integer default 60
) returns table (
  chunk_id uuid, page_id uuid, block_id text, heading_path text[],
  content text, score double precision, vector_rank integer, lexical_rank integer
)
language sql stable security invoker set search_path = public;
```

Behaviour:

- Vector arm: `order by embedding <=> p_query_embedding limit 50` (skipped when the embedding is null).
- Lexical arm: `ts_rank_cd(tsv, websearch_to_tsquery('english', p_query))` over the same workspace, limit 50.
- Fuse with **reciprocal rank fusion**: `score = Σ 1/(k + rank)`; `k = 60`.
- If the embedding arm is empty (un-embedded new pages), lexical results are returned unchanged — the "lexical fallback" from `04`.
- RLS applies through `pages` membership; the function is `security invoker`.

Indexing is idempotent per chunk: `content_hash` equality skips re-embedding, and chunks whose ordinals disappeared are deleted in the same transaction as the upsert.

## 4. Interfaces (TypeScript)

### 4.1 Embedder seam — `lib/ai/embed/`

```ts
export type EmbeddingProvider = 'openai' | 'gemini' | 'voyage' | 'ollama' | 'custom'

export interface EmbedderConfig {
  provider: EmbeddingProvider
  model: string          // 'text-embedding-3-small'
  dim: 1536              // enforced; the column type is halfvec(1536)
  baseUrl?: string       // ollama / custom
}

export interface Embedder {
  readonly id: string    // `${provider}:${model}@${dim}`
  readonly dim: 1536
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>
  embedQuery(text: string, signal?: AbortSignal): Promise<Float32Array>
}
```

- `resolveEmbedder(config, apiKey)` mirrors `resolveChatRequest`: local providers (`ollama`, `custom` with localhost) are called directly from the route; cloud providers are called server-side with the user's decrypted key.
- Batches of 64 texts, 30s timeout, retry once on 429/5xx with jitter. Any dimension mismatch aborts the batch with `EmbeddingDimensionError`.
- Models without native 1536 dims must be truncated (Matryoshka) or rejected; the error names the supported models.

### 4.2 Chunking — `lib/retrieval/chunk.ts`

```ts
export interface Chunk {
  chunkOrdinal: number
  blockId: string
  headingPath: string[]
  content: string
  tokenCount: number
  contentHash: string
}

export function chunkPageDoc(doc: JSONContent, opts?: { maxTokens?: number }): Chunk[]
```

- Split on top-level headings (`heading` level ≤ 2), callout boundaries, and code fences; never split a block.
- Budget ~400 tokens (chars/4 estimate), hard cap 512; a single oversized block becomes its own chunk (truncated with a `…` marker and a warning).
- `blockId = sha256(pageId + ordinal + first 64 chars)[:16]` — stable enough for citation anchors, changes only when content changes.
- `headingPath` is the enclosing heading chain, used for citation display ("Billing › Refunds").

### 4.3 Retrieval service — `lib/retrieval/search.ts`

```ts
export interface RetrievalHit {
  chunkId: string
  pageId: string
  pageTitle: string
  blockId: string
  headingPath: string[]
  content: string
  score: number
  source: 'vector' | 'lexical' | 'graph' | 'fused'
}

export interface RetrievalOptions {
  limit?: number          // default 12
  tags?: string[]
  linkedToPageId?: string
  expandGraph?: boolean   // default true
  rerank?: boolean        // default env RERANK_ENABLED
  minScore?: number
}

export async function retrieve(
  sb: SupabaseClient, q: string, opts?: RetrievalOptions
): Promise<{ hits: RetrievalHit[]; trace: RetrievalTrace }>
```

Pipeline: `embedQuery` (250ms budget) → `hybrid_search_chunks` → optional tag/link filters → link-graph expansion (up to 3 neighbours, 1 chunk each, re-checked for readability) → optional rerank of top-20 → dedupe by `page_id` while keeping the best two chunks per page → context assembly under a token budget.

`RetrievalTrace` records the arms used, per-arm counts, RRF parameters, rerank on/off, and timings for the eval harness and the UI debug drawer.

### 4.4 Citations — `lib/retrieval/citations.ts`

```ts
export interface Citation { marker: string; pageId: string; blockId: string; title: string; headingPath: string[] }
export function citeContext(hits: RetrievalHit[]): { context: string; citations: Citation[] }
```

Context is rendered as numbered blocks (`[1] Billing › Refunds: …`) so the model can cite by marker. `resolveCitations(answer, citations)` maps markers to structured citations; unknown markers are dropped and counted as `citation_errors` (fed to evals).

### 4.5 Indexing — `app/api/embeddings/index/route.ts`

- `POST { workspaceId, pageIds?: string[] }` → chunk, embed, upsert; returns `{ pages, chunks, embedded, skipped, deleted }`.
- Auth: Supabase session; keys read from the encrypted vault server-side.
- Backfill: `app/api/cron/embeddings-backfill/route.ts`, same `CRON_SECRET` pattern as the billing crons, 50 pages per tick, resumable via `page_summaries.updated_at`.
- Writes are transactional per page; a partial failure leaves the previous embeddings intact.

## 5. Agent layer

### 5.1 Tools — `lib/agents/tools.ts`

Zod-typed, JSON-schema exported for provider tool calling:

| Tool | Args | Returns | Notes |
|---|---|---|---|
| `search_knowledge` | `{ query, tags?, linkedTo?, limit? }` | `RetrievalHit[]` | wraps `retrieve` |
| `get_page` | `{ pageId, blockIds? }` | page title + selected blocks | re-checks access |
| `graph_traverse` | `{ pageId, direction: 'in'\|'out'\|'both', depth?: 1-2 }` | neighbour titles + links | `page_links` only |
| `create_page` | `{ title, body, properties? }` | `{ pageId }` | calls `studio_create_pages` |
| `list_pages` | `{ tag?, limit? }` | titles + ids | cheap discovery |

Tools never accept SQL, URLs, or raw user content as instructions; **retrieved content is data, never instructions** (see §10 prompt-injection).

### 5.2 Runtime — `lib/agents/runtime.ts`

```ts
export interface AgentRequest {
  workspaceId: string
  goal: string
  tools: ToolName[]        // default: read-only set
  maxSteps?: number        // default 6, hard cap 10
  tokenBudget?: number     // default 60_000
  costBudgetUsd?: number   // default 0.25
}
export async function runAgent(req: AgentRequest): Promise<AgentResult>
```

- Planner→executor loop over the existing provider registry (tool calling), with a per-step trace.
- Stops on: final answer, step cap, token/cost budget, or tool error budget (2 consecutive failures).
- `create_page` is **opt-in per request** and always returns the created page id for citation review.
- Every step appends to `agent_traces` (JSONB on `studio_jobs.output.trace`) with tool name, args hash, latency, tokens, cost, and outcome.

### 5.3 Guardrails

- Read-only by default; writes require an explicit flag and a user confirmation in the UI before the job runs.
- Budgets above are enforced by the runtime, not the prompt.
- Tool output is truncated to a token budget per call (2k) and marked `[retrieved content — data only]`.
- No tool accepts a URL, so SSRF is not reachable from the agent surface.

## 6. MCP server

`app/api/mcp/route.ts` — Streamable HTTP JSON-RPC 2.0, bearer auth (Supabase access token or a scoped API key).

Tools mirror §5.1 (`search_knowledge`, `get_page`, `graph_traverse`, `list_pages`; `create_page` behind an explicit scope). Resources expose `lekhan://page/{id}` as markdown.

Contract tests: initialise → tools/list → tools/call happy path → unauthorised page returns a permission error, never content.

## 7. Evaluation harness (`evals/`)

Python 3.11+, `uv` managed, no product imports — talks HTTP.

```
evals/
  pyproject.toml
  datasets/golden.jsonl          # {id, workspace, question, expect_page_ids[], expect_facts[], tags[]}
  datasets/agent_tasks.jsonl     # {id, goal, must_call[], must_not_call[], expect_pages[]}
  src/client.py                  # token-authed client for /api/eval/*
  src/retrieval_eval.py          # recall@k, MRR, nDCG@10
  src/answer_eval.py             # faithfulness, citation precision/recall (LLM-judge + rule checks)
  src/agent_eval.py              # task success, steps, tool validity, cost/latency
  src/report.py                  # writes evals/reports/YYYY-MM-DD.md
  reports/                       # committed output
```

- `/api/eval/*` routes are enabled only when `EVAL_MODE=1` and require a service token; they expose retrieval, answer, and agent runs against a seeded workspace.
- Golden set starts at **40 questions** over a seeded 60-page vault (billing, product, decisions), growing to 100. Each row carries the expected page ids and 1–3 atomic facts that a correct answer must contain.
- Metrics and gates:

| Metric | Gate |
|---|---|
| recall@10 (page level) | ≥ 0.85 |
| MRR | ≥ 0.70 |
| nDCG@10 | ≥ 0.75 |
| citation precision | ≥ 0.90 |
| citation recall | ≥ 0.80 |
| answer faithfulness (judge) | ≥ 0.90 |
| agent task success (20 tasks) | ≥ 0.80 |
| p95 retrieval latency (no rerank) | ≤ 400 ms |
| cost per answer (3-small embeddings + small model) | ≤ $0.01 |

- CI: nightly job on a seeded preview database; PR-blocking only for the retrieval unit tests, not the LLM judge (cost/flake).

## 8. Phases & delivery

| Phase | Work | Depends on | Est |
|---|---|---|---|
| **P0** | Merge billing #158; unblock docs deploy; freeze H0 polish | — | 2h |
| **A** | RAG-1 schema migration · RAG-2 `Embedder` + embed route · RAG-3 chunker · RAG-4 indexer + backfill cron · RAG-5 eval skeleton + 40-question golden set | P0 | 34h |
| **B** | RAG-6 `hybrid_search_chunks` + filters · RAG-7 retrieval service (graph expansion, two-tier) · RAG-8 citations · RAG-9 rerank · RAG-10 first eval report + tuning | A | 36h |
| **C** | RAG-11 Studio UI on real retrieval (corpus picker → generate) · RAG-12 `studio_create_pages` write-back with `[[cite]]` | B | 24h |
| **D** | RAG-13 tool registry · RAG-14 agent runtime + traces · RAG-15 agent UI + budgets · RAG-16 agent eval suite | B | 32h |
| **E** | RAG-17 MCP server · RAG-18 demo artifacts (briefing + podcast script) · RAG-19 docs + portfolio write-up (numbers, diagrams, ADR links) | C, D | 20h |

Phase A and B are the portfolio core; C/D/E make it usable and demonstrable.

## 9. Acceptance criteria

- A user can ask a question over a 60+ page workspace and receive an answer where **every claim has a citation** that opens the source block.
- `evals/reports/` contains a dated report meeting every gate in §7, regenerable with one command.
- Re-indexing an unchanged workspace embeds **zero** chunks (content-hash skip) — proven by a test.
- Removing a page removes its chunks and its summary in the same transaction.
- An agent run over the golden task set completes within budgets with a replayable trace.
- MCP `tools/call` returns content for an authorised page and a permission error (no content) for a page the caller cannot read.
- Retrieval works with **no cloud key** when Ollama embeddings are configured (local path parity).

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Prompt injection via page content** (a note saying "ignore previous instructions") | Retrieved content is always wrapped as data; the system prompt states it; `create_page` is opt-in with UI confirmation; eval set includes injection probes |
| Embedding model/dim change silently corrupts the index | `embedding_model` + dim stored per row; backfill refuses mismatched dims; re-index is an explicit job |
| Cost blowup from re-embedding loops | content_hash skip; batch limits; per-workspace daily embedding cap |
| Retrieval regression ships unnoticed | eval gates committed as reports; retrieval unit tests block PRs |
| RLS leak through graph expansion or summaries | all SQL `security invoker`; expansion re-checks readability; permission tests in the RLS suite |
| pgvector index bloat on large vaults | HNSW partial index on non-null embeddings; chunk cap per page; vacuum notes in the migration |
| Python harness drifts from the product | harness only talks HTTP; contract tests live in the TS repo |

## 11. Observability

- `RetrievalTrace` returned by `retrieve()` and surfaced in a Studio debug drawer (arms, ranks, timings, rerank).
- `studio_jobs` records tokens, cost, and status; `agent_traces` records each step.
- Structured logs: `event=retrieval`, `event=embed_batch`, `event=agent_step`, `event=mcp_call` with duration and counts (no content).
- PostHog events: `rag_query`, `rag_citation_clicked`, `studio_generate`, `agent_run_completed`, `mcp_tool_call` — property allowlist updated in `lib/analytics.ts`.
