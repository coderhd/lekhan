---
name: Story
about: A single unit of dev work, ready for tech-lead review once this is filled in
title: "Collapse the Hub Page Persistence Pipeline"
labels: "architecture, tech-debt, sync-engine"
---

# feat(sync): collapse hub page persistence pipeline into deep PagePersister module

**Part of:** #77 (Sync Engine Hardening & Architecture)

## Problem Statement & User Persona

**Problem Statement:** In `server/index.js`, `saveDocumentState` is a shallow function that leaks Yjs encoding, server-side encryption (`server/crypto.js`), Supabase storage uploads, Postgres document updates, graph indexing (`server/graph-index.js`), and version pruning (`server/retention.js`) directly across the WebSocket sync hub. 
This tangles WebSocket handlers with persistence logic, making it difficult to test persistence in isolation. Furthermore, failures in non-critical paths (like indexing or retention) risk failing the entire snapshot save. We need to deepen page persistence behind a cohesive `PagePersister` domain module (`server/persister.js` or `server/persistence/`) presenting a clean, unified `persist(pageId, ydoc)` interface to the WebSocket hub.

**User Persona:** Platform/Infrastructure Engineer (improving testability, system isolation, and maintainability) and End User (benefitting from reliable sync).

## Capability Map

| Module id | Responsibility | Depends on |
|---|---|---|
| persistence-orchestration | Orchestrate Yjs encoding, encryption, storage upload, DB update | — |
| error-isolation | Protect core snapshot save from non-critical failures (indexing, retention) | persistence-orchestration |
| hub-seam | Decouple WebSocket handlers from internal persistence/crypto/storage logic | persistence-orchestration |

Build order: persistence-orchestration → error-isolation → hub-seam

## Acceptance Criteria

- **Given** a dirty Yjs document in the WebSocket hub, **when** `PagePersister.persist(pageId, ydoc)` is called, **then** it performs encryption, storage upload, DB update, graph index update (when E2E encryption is disabled), and retention in one awaitable call.
- **Given** the persistence orchestration runs, **when** non-critical systems (like graph index or version retention) fail, **then** the failures are logged but do not fail the overall document snapshot save.
- **Given** the WebSocket connection handlers in `server/index.js`, **when** a document state needs saving, **then** they only interact with `PagePersister.persist`, with zero leakage of Yjs encoding, crypto, storage, or indexing details.
- **Given** the `PagePersister` module, **when** running unit/integration tests, **then** the persistence engine can be fully tested using mock storage/db adapters without running the WebSocket server.

## Definition of Ready Checklist

- [x] Problem Statement and User Persona are explicitly defined.
- [x] Capability Map (module IDs, dependency direction, build order) is defined.
- [x] Acceptance Criteria follow strict Given / When / Then format.
- [x] Relevant ADRs (0001: Encryption at rest, 0004: Server-hub CRDT sync topology) are reviewed.
- [x] The spec aligns with the single-source-of-truth product documentation.

## ADR reference

- `docs/adr/0001-encryption-at-rest-by-default-e2e-as-plus.md`
- `docs/adr/0004-server-hub-crdt-sync-topology.md`
