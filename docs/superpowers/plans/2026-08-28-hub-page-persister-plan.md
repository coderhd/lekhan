# Technical Design Plan: Hub Page Persister

## 1. Context & Motivation
Currently, in `server/index.js`, the WebSocket sync handlers are tangled with persistence logic. They manage Yjs encoding, encryption, Supabase storage uploads, database updates, graph indexing, and version retention. This violates the principles of Deep Modules (as defined in `codebase-design`) by exposing a shallow interface where the caller manages the orchestration. It also tightly couples the network transport (WebSockets) with the data persistence layer, making it difficult to test persistence in isolation and risking the entire snapshot save if a non-critical subsystem (like indexing) fails.

We will deepen page persistence behind a `PagePersister` module that presents a single, cohesive `persist(pageId, ydoc)` interface, effectively creating a clean seam.

## 2. Interface Contract (`types.ts` representation)

```typescript
export interface PersisterConfig {
  supabaseAdmin: SupabaseClient;
  isE2EEnabled?: boolean; // Controls whether server-side indexing is skipped (ADR 0001)
  indexer?: GraphIndexer;
  retentionEngine?: RetentionEngine;
  authService?: AuthService;
}

export interface PersistResult {
  success: boolean;
  documentId: string;
  nonCriticalResults: {
    indexingSuccess: boolean;
    retentionSuccess: boolean;
  };
}

export interface PagePersister {
  /**
   * Persists a Yjs document. Orchestrates encoding, encryption, storage upload,
   * database updates, graph indexing, and version retention.
   * 
   * Non-critical failures (e.g. indexing, retention) are caught and logged,
   * allowing the primary snapshot save to succeed.
   */
  persist(documentId: string, ydoc: Y.Doc): Promise<PersistResult>;
}

// Factory function defining the seam
export function createPagePersister(config: PersisterConfig): PagePersister;
```

*Note: While `isE2EEnabled` is currently part of the module configuration, in a multi-tenant environment this flag may eventually need to be resolved dynamically per-workspace (or passed into `persist()`) to strictly adhere to ADR-0001's opt-in nature.*

## 3. Pipeline Steps & Failure Domains

The `persist` method executes the following pipeline:

1. **Critical Path (Must Succeed)**:
   - **Encode**: Convert the `Y.Doc` to a binary state update.
   - **Encrypt**: Apply server-side encryption at rest (ADR-0001).
   - **Storage Upload**: Upload the encrypted binary to Supabase Storage (`documents/<id>/main_state.bin`).
   - **Database Update**: Update the text content in `documents` / `pages` table.
   *Failure Domain: If any of these fail, the `persist` operation throws (or returns success: false), and the WebSocket layer is notified of a failed sync.*

2. **Non-Critical Path (Isolated Failures)**:
   - **Graph Indexing**: If `isE2EEnabled` is false (or per-call option `options.isE2EEnabled` is false), extract text content and invoke `indexer.indexPage`. If true, skip indexing.
   - **Retention Sweeps**: Invoke `retentionEngine.pruneExpiredDocumentVersions` based on the owner's plan limits.
   *Failure Domain: Failures in indexing or retention (whether a thrown exception or a resolved `{ success: false }` result) are caught, logged, and returned in `nonCriticalResults`. They DO NOT fail the overall save operation.*

## 4. Seam Placement & Testability

The seam is placed directly between the WebSocket handlers (`server/index.js`) and the persistence orchestration (`server/persister.js`). 
- **WebSocket Handlers**: Deal only with connection limits, message validation, and invoking `pagePersister.persist()`. Zero leakage of Yjs encoding, crypto, or Supabase logic.
- **Testability**: Because `createPagePersister` accepts its dependencies (`supabaseAdmin`, `indexer`, `retentionEngine`, etc.), the entire persistence engine can be unit tested without spinning up the WebSocket server. We can pass mock storage adapters and verify error isolation.

## 5. Deletion Test & Leverage/Locality Evaluation

- **Deletion Test**: If we imagine deleting `PagePersister`, the orchestration of 5 distinct operations (encode, encrypt, upload, index, prune) and their respective `try/catch` boundaries would spill back into `server/index.js`. The complexity re-appears exactly where we don't want it, proving the module earns its keep.
- **Leverage**: The caller (WS hub) gets a massive capability (a fully encrypted, indexed, and pruned storage save) in a single method call: `await pagePersister.persist(docId, ydoc)`.
- **Locality**: A developer changing the indexing strategy, modifying encryption algorithms, or altering retention rules only needs to look at `server/persister.js`. Fix once, fixed everywhere.
