---
tags: [open-question, h3-studio, architecture, risk]
status: open
date: 2026-08-29
---

# Studio's strongest differentiators depend on work not yet shipped

[[02-positioning-individual-pkm-first]] leans on two claims: full local BYOL and offline capability, as what neither NotebookLM nor Rovo can match. Per `docs/roadmap.md`, both depend on the Tauri Desktop Shell (#88 — vault-on-disk + llama.cpp sidecar), whose milestones (#88-M1, #88-M2) are still `Backlog`, targeted Oct 13 – Nov 3. Today's shipped architecture is the web app on Supabase (per `PRODUCT.md`'s "Evidence on Hand").

**Implication:** if Studio ships before #88, its two strongest claims against Rovo/NotebookLM are aspirational, not real yet — Studio-on-web-today is "another BYOK-powered cloud RAG feature," a weaker position than argued in [[02-positioning-individual-pkm-first]]. Worth deciding explicitly whether Studio's thin v1 ([[06-thin-v1-before-deep-rag]]) should wait for #88, or ship earlier with the differentiation claim scoped down to "graph-native write-back" only (real today) rather than "local + offline" (not real until #88 lands).

**Related:** [[02-positioning-individual-pkm-first]], [[06-thin-v1-before-deep-rag]]
