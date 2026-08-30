---
tags: [decision, h3-studio, architecture, open-question]
status: open
date: 2026-08-29
---

# H3 Studio: retrieval architecture refinements (deep version, not yet built)

Plan for *if/when* the deep RAG layer is built — see [[06-thin-v1-before-deep-rag]] for why it isn't built first:

1. **Block-aware chunking**, not fixed 800-token windows — split along Tiptap block boundaries (headings, callouts) so citations resolve to a real section, not an arbitrary window.
2. **Link-graph expansion** — after top-k vector retrieval, pull in pages connected via `page_links` (in or out) before assembling context, the same way code-editor tools follow an import graph. Stronger signal here than for code, since a `[[wikilink]]` is deliberate user intent, not an inferred dependency.
3. **Two-tier retrieval** — one embedding per Page (title + summary) to narrow candidate Pages first, then chunk-level embeddings only within those candidates. Main mitigation for the fact that a personal vault is an unbounded, uncurated corpus, unlike NotebookLM's manually curated notebook.
4. **Lexical fallback** — fall back to the existing `pg_trgm` search for pages whose chunks haven't finished embedding yet, rather than serving stale/partial vector results.

**Honest limitation:** link-graph expansion only helps pages that are actually linked; isolated tag-only notes get no boost from it.

**Schema implication if built:** `page_chunks` needs block-ordinal boundaries per chunk, and either a `page_summaries` table or a summary embedding column on `pages` — worth deciding before the migration is written, since retrofitting means re-embedding everything twice.

**Related:** [[06-thin-v1-before-deep-rag]]
