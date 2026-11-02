---
tags: [decision, h3-studio, ai, rag, agents, portfolio]
status: accepted
date: 2026-11-02
supersedes: 06-thin-v1-before-deep-rag
---

# H3 Studio: build the deep RAG layer first — server-side pgvector, pluggable embedder, Python evals

**Decision (owner, 2026-11-02):** H3 builds the deep retrieval layer (the layer `04-retrieval-architecture-plan` designed and `06-thin-v1-before-deep-rag` parked) as the **primary path**, not as a later v2. Thin v1 is retained only as the degraded fallback when retrieval is unavailable or the corpus is tiny.

Two implementation choices were also made:

1. **Embeddings run server-side into `pgvector`.** Not browser-side embeddings.
2. **The product path stays TypeScript; evaluation runs in a Python `evals/` harness.**

## Why this reverses 06

`06` weighed product risk: don't spend multi-week effort proving "users want generated documents" before validating demand. That reasoning still holds *for a commercial roadmap*, but it optimises for the wrong thing here: the project's near-term purpose is to demonstrate **RAG, retrieval quality measurement, and agentic tool use** to a hiring audience. A concatenate-everything prompt demonstrates prompt engineering at best; it produces no retrieval system, no index, no metrics, and no agent.

The tripwire `06` named (large corpora don't fit context) is also trivially reachable: a 300-page vault is normal for the target user, and cost per call with no persistent index makes the thin path worse the more someone uses Lekhan.

## Consequences

### Server-side pgvector

- Chunks and embeddings live next to the graph (`page_chunks`, `page_summaries`) and are queried by a `SECURITY INVOKER` SQL function, so existing RLS (`can_access_page()` / page-membership) applies by construction. No new authorisation model.
- Hybrid retrieval can fuse vector hits with the **already-shipped** `pg_trgm` lexical surface and `page_links` graph expansion in one round trip.
- Embedding happens in a route handler that reads the user's key from the encrypted vault — the same BYOK posture as `/api/ai/stream`. Local embedders (Ollama) remain supported through the same interface, so the privacy story survives.
- Cost/latency: one embedding per query, cached; embeddings are written once per content hash, not per request.

### Pluggable embedder

`Embedder` is an interface, not a vendor SDK call. Providers implement it (`openai`, `gemini`, `voyage`, `ollama`, `custom`). The model id **and** dimension are recorded with every chunk's embedding run so a model change is an explicit re-index, not silent corruption. `halfvec(1536)` is the column type; embedders must emit 1536 dimensions (Matryoshka truncation where the provider supports it) or the backfill refuses the batch with a clear error.

### TypeScript product + Python evals

- The shipped system is TypeScript end-to-end: chunking, indexing, retrieval, agents, MCP. That keeps it inside the existing Next.js/Supabase modular monolith and inside the org's review gates.
- Measurement lives in `evals/` (Python, `uv`): golden dataset, retrieval metrics (recall@k, MRR, nDCG), answer faithfulness and citation precision via LLM-judge, agent task success. Python is the lingua franca for this work, and it keeps eval code out of the product bundle.
- The two halves meet at an HTTP boundary: the harness calls a token-authenticated `/api/eval/*` surface against a seeded workspace.

## What this is not

- Not a rewrite of Studio's output model: generation still writes graph-native `Page`s with `[[cite]]` (`03`).
- Not a new authorisation model (`01`).
- Not an office suite (`02`).
- Not a provider abstraction rewrite: `lib/ai/provider-registry.ts` stays the source of truth for chat providers; `Embedder` is a sibling seam, not a parallel registry.

## Acceptance signal

This decision is validated by numbers, not vibes: `evals/reports/` must show recall@10 ≥ 0.85, citation precision ≥ 0.90, and agent task success ≥ 80% on the golden set before the Studio epic is called done.

**Related:** [[04-retrieval-architecture-plan]], [[03-generation-writes-pages-export-is-free]], [[06-thin-v1-before-deep-rag]] (superseded), `docs/superpowers/specs/2026-11-02-h3-studio-rag-agentic-design.md`
