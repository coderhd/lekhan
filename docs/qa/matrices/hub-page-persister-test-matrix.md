# Hub Page Persister Test Matrix

This matrix maps the acceptance criteria for the "Collapse the Hub Page Persistence Pipeline" story to concrete Vitest test cases.

| Test ID | Test Scenario | Given | When | Then | Automation Target |
|---------|---------------|-------|------|------|-------------------|
| **TC01** | Atomic persistence pipeline execution | A valid, dirty Yjs document is provided | `PagePersister.persist(pageId, ydoc)` is called | It successfully encodes state, encrypts, uploads to storage, updates DB, indexes the graph, and triggers retention. Resolves with success. | `server/persister.test.js` (Vitest Unit) |
| **TC02** | Error boundary isolation | A valid Yjs document, but mocked `graph-index` or `retention` throws an error | `persist()` is called | The snapshot upload and DB update succeed. The error from indexing/retention is caught and does NOT fail the overall save. | `server/persister.test.js` (Vitest Unit) |
| **TC03** | Storage failure handling | A valid Yjs document, but Supabase storage upload is mocked to fail | `persist()` is called | The operation aborts. Database update, indexing, and retention are NOT called. Promise resolves/rejects with the underlying error. | `server/persister.test.js` (Vitest Unit) |
| **TC04** | E2E mode awareness | `PagePersister` is instantiated with `isE2EEnabled: true`, valid Yjs doc provided | `persist()` is called | The document is persisted successfully, but server-side graph indexing is entirely skipped per ADR 0001. | `server/persister.test.js` (Vitest Unit) |
| **TC05** | Direct unit testability without WebSocket server | Only `server/persister.js` is loaded, with a mocked Supabase client (no WS server) | `persist()` is called | The tests execute successfully in complete isolation from `server/index.js` or WebSocket hub handlers. | `server/persister.test.js` (Vitest Unit) |
