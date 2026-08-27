# QA Test Matrix: Hub Page Persister

**Epic/Story:** #109 (Collapse the Hub Page Persistence Pipeline)
**Test Framework:** Vitest (Unit/Integration)

## Acceptance Criteria Mapping & Test Scenarios

### TC01: Critical Path Orchestration - Success
**Maps to AC:**
> Given a dirty Yjs document in the WebSocket hub, when `PagePersister.persist(pageId, ydoc)` is called, then it performs encryption, storage upload, DB update, graph index update (when E2E disabled), and retention in one awaitable call.

* **Given:** A valid `Y.Doc` and a properly configured `PagePersister` with mock storage, DB, indexer, and retention engines.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - `success: true` is returned.
  - Storage adapter is called with correctly encrypted binary payload at `${documentId}/main_state.bin`.
  - Database adapter is called to update document text.
  - `indexer.indexPage` is called (if E2E is disabled).
  - `retentionEngine.pruneExpiredDocumentVersions` is called.
  - `nonCriticalResults` shows success for indexing and retention.

### TC02: Error Isolation - Non-Critical Failures Do Not Block Save
**Maps to AC:**
> Given the persistence orchestration runs, when non-critical systems (like graph index or version retention) fail, then the failures are logged but do not fail the overall document snapshot save.

* **Given:** A configured `PagePersister` where the mock `indexer.indexPage` or `retentionEngine.pruneExpiredDocumentVersions` throws an error or returns `{ success: false }`.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - The operation DOES NOT throw.
  - Returns `success: true`.
  - The failed subsystem's status is reflected as `false` in `nonCriticalResults`.
  - Storage upload and DB update/query operations are still executed successfully.

### TC03: Critical Path Failure Blocks Operation
**Maps to Technical Design:**
> Failure Domain: If any of [Encode, Encrypt, Storage Upload, Database Update] fail, the `persist` operation throws/rejects, notifying the WebSocket caller.

* **Given:** A configured `PagePersister` where the storage upload or DB update adapter rejects or returns an error.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - The operation throws/rejects with the underlying storage/database error.
  - Non-critical operations (indexing) are skipped.
  - WebSocket connection handler receives the failure to handle it properly.

### TC04: E2E Mode Awareness (Skip Indexing)
**Maps to Technical Design & ADR 0001:**
> Graph Indexing: If `isE2EEnabled` is false, invoke indexer... If true (either at constructor or per-call options), skip indexing.

* **Given:** A `PagePersister` configured with `isE2EEnabled: true` or passed `{ isE2EEnabled: true }` in `persist()`.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - `indexer.indexPage` is NOT called.
  - Overall operation returns `success: true`.

### TC05: Isolated Testability & Legacy Document Fallback Path
**Maps to AC:**
> Given the `PagePersister` module, when running unit/integration tests, then the persistence engine can be fully tested using mock storage/db adapters without running the WebSocket server.

* **Given:** A missing page row in `pages` table (legacy document).
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - Updates `documents` table (`searchable_text`, `updated_at`).
  - Returns `success: true`.
