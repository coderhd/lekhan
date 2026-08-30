---
tags: [decision, h3-studio, architecture]
status: decided
date: 2026-08-29
---

# H3 Studio: generation writes Pages; office export (O3) rides along for free

**Decision:** Studio's output is always a real Page (via `studio_create_pages` → `sync_page_graph`), not a standalone file. Office export (DOCX/PDF/PPTX/XLSX) is not a separate deliverable to design — it's the existing `exportToDocx`/`exportToPdf` (`lib/export-utils.ts`) operating on a Page that happens to have been generated rather than hand-written.

**Why:** The meeting/triage use case ("extract info into a separate doc") looked at first like a third capability to build. It resolves to G1 (graph-native synthesis) → O3 (export that Page), already composable with zero new plumbing — *provided* generation doesn't require a live DOM-bound editor instance. The MarkdownEngine facade work (engine-only serialize/parse) is what makes that safe: Studio can generate a ProseMirror doc and export it without a mounted editor.

**Consequence for future work:** because the artifact is a real Page, it automatically gets backlinks, appears in graph view, is retrievable by future Studio queries, and inherits version history/collaboration — none of that needs separate design.

**Related:** [[06-thin-v1-before-deep-rag]]
