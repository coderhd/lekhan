---
name: Story
about: A single unit of dev work, ready for tech-lead review once this is filled in
title: "Collapse the Hub Page Persistence Pipeline"
labels: "architecture, tech-debt, sync-engine"
---

**Part of:** #77 (Sync Engine Hardening & Architecture)

## Problem statement

In `server/index.js`, `saveDocumentState` is currently a shallow function that leaks Yjs encoding, server-side encryption (`server/crypto.js`), Supabase storage uploads, Postgres document updates, graph indexing (`server/graph-index.js`), and version pruning (`server/retention.js`) directly across the WebSocket sync hub. 

This causes several issues:
- The WebSocket connection handlers are tangled with persistence logic.
- It is difficult to test persistence in isolation without running the full WebSocket server.
- Failures in non-critical paths (like indexing or retention) risk failing the entire snapshot save if not carefully orchestrated.

We need to deepen page persistence behind a cohesive `PagePersister` domain module (`server/persister.js` or `server/persistence/`) presenting a clean, unified `persist(pageId, ydoc)` interface to the WebSocket hub.

## Acceptance criteria

- **Given** a dirty Yjs document in the WebSocket hub, **when** `PagePersister.persist(pageId, ydoc)` is called (AC 1: Atomic persistence orchestration), **then** it performs encryption, storage upload, DB update, graph index update, and retention in one awaitable call.
- **Given** the persistence orchestration runs, **when** non-critical systems (like graph index or version retention) fail (AC 2: Error boundary isolation), **then** the failures are logged but do not fail the overall document snapshot save.
- **Given** the WebSocket connection handlers in `server/index.js`, **when** a document state needs saving (AC 3: Hub seam decoupling), **then** they only interact with `PagePersister.persist`, with zero leakage of Yjs encoding, crypto, storage, or indexing details.
- **Given** the `PagePersister` module, **when** running unit/integration tests (AC 4: Testability), **then** the persistence engine can be fully tested using mock storage/db adapters without running the WebSocket server.

## ADR reference

- `docs/adr/0001-encryption-at-rest-by-default-e2e-as-plus.md`
- `docs/adr/0004-server-hub-crdt-sync-topology.md`

## QA test plan

See [docs/qa/matrices/hub-page-persister-test-matrix.md](../../qa/matrices/hub-page-persister-test-matrix.md) for the exhaustive acceptance criteria matrix and test scenarios.
