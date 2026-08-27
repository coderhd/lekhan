# Implementation Plan: Collapse the Hub Page Persistence Pipeline

## Objective
Refactor the WebSocket sync hub (`server/index.js`) to extract the document state saving logic into a dedicated, deepened domain module `server/persister.js`. This resolves tangled WebSocket connection handlers, isolates errors in non-critical paths, and significantly improves testability.

## Interface Contract (`server/persister.js`)

```javascript
/**
 * @typedef {Object} PersistenceResult
 * @property {boolean} success - Whether the critical persistence path succeeded
 * @property {Error} [error] - The error if the critical path failed
 * @property {Object} nonCriticalResults - Outcomes of non-blocking steps
 * @property {boolean} nonCriticalResults.indexingSuccess
 * @property {boolean} nonCriticalResults.retentionSuccess
 */

/**
 * Creates a configured PagePersister instance.
 *
 * @param {Object} config
 * @param {import('@supabase/supabase-js').SupabaseClient} config.supabaseAdmin
 * @param {boolean} [config.isE2EEnabled=false] - If true, skips server-side indexing
 * @returns {{ persist: (documentId: string, ydoc: import('yjs').Doc) => Promise<PersistenceResult> }}
 */
function createPagePersister({ supabaseAdmin, isE2EEnabled = false }) {
    return {
        /**
         * Persists the given Yjs document to storage and database,
         * then triggers non-blocking indexing and retention.
         */
        persist: async (documentId, ydoc) => {
            // Pipeline steps...
        }
    };
}

module.exports = { createPagePersister };
```

## Step-by-step Execution Plan

### Step 1: Create `server/persister.js`
1. Initialize the file and export the `createPagePersister` factory.
2. Require necessary dependencies: `yjs`, `server/crypto.js` (`encryptSnapshot`), `server/graph-index.js` (`indexPage`), `server/retention.js` (`pruneExpiredDocumentVersions`), and auth helpers (`getDocumentOwnerPlan`).

### Step 2: Implement the Critical Persistence Path (Blocking)
Inside the `persist` function, execute the critical path steps sequentially:
1. **Yjs state encoding**: Call `Y.encodeStateAsUpdate(ydoc)`.
2. **Encryption**: Pass the encoded buffer to `encryptSnapshot(buffer)` (from `crypto.js`) to encrypt at rest.
3. **Storage Upload**: Upload the encrypted binary to the `pages-encrypted` bucket at `${documentId}/main_state.bin`.
4. **Database Update**: Update the `pages` table with `updated_at` (now) and `storage_path` (`${documentId}/main_state.bin`).
   *If any of these steps fail, catch the error, log it, and return `{ success: false, error }` (or throw, based on consumer expectation).*

### Step 3: Implement Error-Isolated Follow-on Operations (Non-blocking)
After the critical path succeeds, spawn non-blocking tasks.
1. **Graph Indexing**: 
   - Extract plain text via `ydoc.getText('default').toString()`.
   - Call `graphIndex.indexPage(supabaseAdmin, documentId, text)`.
   - Append `.catch(...)` to isolate failures. Only run if `isE2EEnabled` is false (since E2E encryption hides content from the server).
2. **Retention Version Pruning**:
   - Fetch the document owner plan.
   - Call `pruneExpiredDocumentVersions(supabaseAdmin, documentId, plan, new Date())`.
   - Append `.catch(...)` to isolate failures.
3. **Return Result**: Wait for the background promises to finish or just fire-and-forget them. Wait is safer for graceful shutdown. Return `{ success: true, nonCriticalResults: ... }`.

### Step 4: Refactor `server/index.js`
1. Remove `saveDocumentState` and its tangled inline logic.
2. Import `createPagePersister` and instantiate it with the global `supabaseAdmin`.
3. In `triggerSerializedSave` (or the equivalent save execution path), call `pagePersister.persist(documentId, ydoc)`.
4. Ensure any test mocks in `server/index.test.js` or equivalent are updated to mock `server/persister.js` rather than testing inline logic.

## Technical Feasibility & Risks
- **Feasibility:** High. The existing code inside `server/index.js` already performs these steps, so extracting it is purely organizational. 
- **Bucket Change:** The prompt indicates a change to the `pages-encrypted` bucket (currently `documents`). We need to ensure Supabase migrations or provisioning create this bucket.
- **Backward Compatibility:** Need to verify if the client relies on the bucket name for downloads or if they fetch via the server WebSocket.
- **E2E Toggle:** Exposing `isE2EEnabled` cleanly bridges the gap called out in ADR 0001 where server-side search is disabled when E2E is active.
