---
tags: [moc, decision-log]
---

# Decision Log

A running log of product/architecture decisions and open questions for Lekhan — the "why did we choose X" record that currently lives only in chat history and memory. Point Obsidian at the repo root (or at least `docs/`) so the `[[wikilinks]]` below resolve to the existing ADRs/specs.

## How to use this
- **Tags**: `#decision` (settled, with rationale), `#open-question` (deliberately parked, revisit later), `#architecture-fact` (a clarification, not a choice — corrects a misconception), `#external-input` (analysis received from elsewhere, not a decision made here).
- **Status** in frontmatter: `decided`, `open`, or `reference`.
- New entries go in the relevant subfolder and get linked back here.

## Core architecture (already formalized as ADRs)
- [[0001-encryption-at-rest-by-default-e2e-as-plus]] — encryption default, E2E as a paid tier
- [[0002-free-history-retention-one-day]] — free-tier history retention window
- [[0003-desktop-markdown-plus-yjs-sidecar]] — `.md` files + hidden CRDT sidecar on desktop
- [[0004-server-hub-crdt-sync-topology]] — hub-relay sync topology

## H3 "Studio" — in progress
- [[01-one-architecture-not-team-vs-individual]]
- [[02-positioning-individual-pkm-first]]
- [[03-generation-writes-pages-export-is-free]]
- [[04-retrieval-architecture-plan]]
- [[05-collaboration-file-truth-tradeoff]]
- [[06-thin-v1-before-deep-rag]] — currently the live open question, not yet scheduled

## Architecture facts / clarifications
- [[permission-substrate-vs-team-workspace]]

## External input
- [[chatgpt-strategy-summary-2026-08-29]] — analysis received from a separate ChatGPT conversation, not a decision made here
