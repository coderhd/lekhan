# QA Test Matrix: Hub Page Persister

**Epic/Story:** #109 (Collapse the Hub Page Persistence Pipeline)
**Test Framework:** Vitest (Unit/Integration)

## Acceptance Criteria Mapping & Test Scenarios

### TC01: Critical Path Orchestration - Success
**Maps to AC:**
> Given a dirty Yjs document in the WebSocket hub, when `PagePersister.persist(pageId, ydoc)` is called, then it performs encryption, storage upload, DB update, graph index update, and retention in one awaitable call.

* **Given:** A valid `Y.Doc` and a properly configured `PagePersister` with mock storage, DB, indexer, and retention engines.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - `success: true` is returned.
  - Storage adapter is called with correctly encrypted binary data.
  - Database adapter is called to update document text.
  - `indexer.indexPage` is called (if E2E is disabled).
  - `retentionEngine.pruneExpiredDocumentVersions` is called.
  - `nonCriticalResults` shows success for indexing and retention.

### TC02: Error Isolation - Non-Critical Failures Do Not Block Save
**Maps to AC:**
> Given the persistence orchestration runs, when non-critical systems (like graph index or version retention) fail, then the failures are logged but do not fail the overall document snapshot save.

* **Given:** A configured `PagePersister` where the mock `indexer.indexPage` or `retentionEngine.pruneExpiredDocumentVersions` throws an error.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - The operation DOES NOT throw.
  - Returns `success: true`.
  - The failed subsystem's status is reflected as `false` in `nonCriticalResults`.
  - Storage upload and DB updates must still be executed successfully.

### TC03: Critical Path Failure Blocks Operation
**Maps to Technical Design:**
> Failure Domain: If any of [Encode, Encrypt, Storage Upload, Database Update] fail, the `persist` operation throws (or returns success: false).

* **Given:** A configured `PagePersister` where the storage upload or DB update adapter throws an error.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - Returns `success: false` (or throws an explicit error).
  - WS connection handler receives the failure to handle it properly.

### TC04: Hub Seam Encapsulation
**Maps to AC:**
> Given the WebSocket connection handlers in `server/index.js`, when a document state needs saving, then they only interact with `PagePersister.persist`, with zero leakage of Yjs encoding, crypto, storage, or indexing details.

* **Given:** The `server/index.js` sync handlers and a mock `PagePersister`.
* **When:** A save event is triggered via WS.
* **Then:**
  - `PagePersister.persist` is called with correct arguments.
  - Assert that no direct calls to `Y.encodeStateAsUpdate`, crypto functions, or Supabase clients are made by `server/index.js`. (Unit test / mock verification).

### TC05: E2E Encryption Branch (Skip Indexing)
**Maps to Technical Design:**
> Graph Indexing: If `isE2EEnabled` is false, invoke indexer... If true, skip indexing.

* **Given:** A `PagePersister` configured with `isE2EEnabled: true`.
* **When:** `pagePersister.persist(pageId, ydoc)` is executed.
* **Then:**
  - `indexer.indexPage` is NOT called.
  - Overall operation returns `success: true`.
