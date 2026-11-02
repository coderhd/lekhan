---
tags: [decision, h3-studio, open-question, roadmap]
status: superseded
date: 2026-08-29
---

# H3 Studio: ship a thin v1 before building the deep RAG layer — open, parked

> **Superseded 2026-11-02** by [[08-deep-rag-first-embedder-and-eval-stack]]: the deep retrieval layer is now the primary path (server-side `pgvector`, pluggable embedder, Python evals). Thin v1 survives only as the degraded fallback. The product-risk argument below is kept for the record.

**Current position (parked, not abandoned):** it's too early to know whether users actually want AI-generated documents from their knowledge base, and the full chunking/embedding/pgvector layer ([[04-retrieval-architecture-plan]]) is real, multi-week work competing with the rest of the roadmap. Before committing to it, ship a thin version that proves the value:

- Corpus selection UI (tag/link/explicit-page picker) — check for reuse from AI Panel v2 / mentions work first.
- No chunking, no embeddings, no pgvector: concatenate the filtered pages' raw markdown directly into the prompt (context windows are large enough for a tag-filtered slice of a personal vault) and let the model's own reasoning do the retrieval.
- The one genuinely new piece: turn the model's response into a real Page via `studio_create_pages` (see [[03-generation-writes-pages-export-is-free]]).

**Degrades exactly where the deep version was built to help:** large tags (hundreds of pages) won't fit in context, and cost scales per call with no persistent index to amortize against. That's the intended tripwire — if usage stays inside "a few dozen filtered pages," the deep layer may never be needed; if it doesn't, real usage data will show which corpus sizes broke, instead of guessing upfront.

**Status: open.** Not scheduled against the rest of the roadmap yet. Revisit this note before starting H3 Studio implementation.

**Related:** [[04-retrieval-architecture-plan]], [[03-generation-writes-pages-export-is-free]]
