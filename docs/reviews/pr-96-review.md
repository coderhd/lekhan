# Code Review: PR #96 - feat(security): encrypt page snapshots and version checkpoints at rest (#81, ADR 0001)

**Reviewer**: Clean-Room OpenRouter (z-ai/glm-5.2:free)
**Date**: 2026-08-26T20:34:27.001Z

We need to review this PR. The user wants a clean-room adversarial peer code review, with specific objectives: logical bugs, concurrency race conditions, memory leaks, state corruption, ADR 0001 compliance, ADR 0004 compliance, privacy boundaries, API route safety.

We must output structured code review with findings by severity, file/line references, failure scenarios, recommended fixes.

We need to analyze the diff and the provided files. The PR adds encryption at rest for page snapshots and version checkpoints. It introduces `lib/server-crypto.ts` and `server/crypto.js`, modifies `app/api/import/route.ts`, `app/api/version/route.ts`, `components/version-history.tsx`, `server/index.js`, adds tests, runbook, backfill script.

We need to check for any issues: security, logic, concurrency, memory, state corruption, ADR compliance, privacy, API safety.

Let's go through each file.

First, `lib/server-crypto.ts`:
- Uses AES-256-GCM, 96-bit IV, 128-bit auth tag, magic header `LK_ENC_V1`.
- `deriveKeyFromSecret` uses SHA-256 hash of secret string to get 32-byte key. That's fine.
- `getPrimaryKey` reads env vars: `LEKHAN_ENCRYPTION_KEY`, fallback to `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, then a hardcoded default dev secret. This is a bit risky: using a hardcoded default secret in production could happen if env vars are missing, but they note it's for local development. However, if deployed without setting `LEKHAN_ENCRYPTION_KEY`, it will fall back to `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, which are likely set in production (Supabase service role key). That's okay, but the default dev secret is a potential issue if someone deploys without setting any key and uses the default, which would be weak and known. But it's probably acceptable for dev, but we should note that in production the key must be set explicitly. However, the runbook says "In local development, if LEKHAN_ENCRYPTION_KEY is omitted, the server derives a deterministic key from SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY". The default dev secret is only used if both are missing. That might be okay but could lead to accidental use of a known key in production if misconfigured. This is a MEDIUM or LOW finding.

- `getPreviousKeys` splits env var by comma, trims, filters, derives keys. Good.

- `isEncryptedSnapshot` checks length and magic header. Good.

- `encryptSnapshot`: uses random IV, creates cipher, updates, final, gets auth tag, concatenates. Good.

- `decryptSnapshot`: checks if encrypted, if not returns buffer as-is (legacy passthrough). Then checks length, extracts iv, tag, ciphertext. Tries primary key, then previous keys. If all fail throws. Good.

Potential issues:
- The `decryptSnapshot` function returns a Buffer. In `server/index.js`, they do `const decrypted = decryptSnapshot(Buffer.from(arrayBuffer))` and then `new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)`. That's fine, but note that if the buffer is not encrypted, `decryptSnapshot` returns the original buffer, which is a Buffer. Then they create a Uint8Array view over the underlying buffer. That's fine. However, if the buffer is encrypted and decrypted, the returned Buffer is a new Buffer. Then they create a Uint8Array view. That's okay.

- In `server/index.js`, they import `encryptSnapshot, decryptSnapshot` from `./crypto`. That's the CommonJS version. Good.

- In `app/api/import/route.ts`, they import `encryptSnapshot` from `@/lib/server-crypto`. They encrypt the raw buffer before uploading. Good.

- In `app/api/version/route.ts`, they refactor to use `createClients` helper. They added GET endpoint. Let's examine the GET endpoint carefully.

The GET endpoint:
- Extracts token from Authorization header.
- Creates clients.
- Gets user.
- Gets `documentId` and `versionId` query params.
- Checks page access: looks up `pages` table with admin client, checks `is_public`, `owner_id`, else checks `page_members` with caller client (RLS). If not found, falls back to `documents` table similarly. This seems okay.
- Then downloads the binary from storage using admin client.
- Decrypts with `decryptSnapshot`.
- Returns the decrypted bytes as response.

Potential issues:
- The download uses `supabaseAdmin.storage.from('documents').download(...)`. The path is `${documentId}/versions/${versionId}.bin`. But note: the `documentId` could be a page id or a legacy document id. In the POST, they inserted a `document_versions` record with `page_id` set to `documentId` if page exists, else `document_id` for legacy. The storage path uses `${documentId}/versions/${versionId}.bin`. That's consistent.

- However, the GET endpoint does not verify that the version record exists and matches the documentId. It directly downloads the binary. If the versionId is arbitrary, someone could guess version IDs and download them if they have read access to the page. But the read access is checked. However, what if the version binary doesn't exist? It returns 404. That's fine.

- But there's a potential issue: The GET endpoint uses `supabaseAdmin.storage.download` which bypasses RLS. That's fine because they already checked access manually. However, they check access based on `pages` or `documents` table. But what if the `documentId` is a legacy document that is not in `pages` but in `documents`? They handle that. But what about the case where the page is public? They check `page.is_public`. Good.

- However, there is a subtle bug: In the POST, they check permissions: only owners and editors can create versions. They check `page` existence and then check `page_members` role. In the GET, they check read access for owner, member, or public. That seems fine.

- But note: In the GET endpoint, they use `supabaseAdmin.from('pages').select('id, is_public, owner_id')...`. Then they check `page.is_public || page.owner_id === user.id`. If not, they check `page_members`. But what if the page is not public, user is not owner, but is a member? They check `page_members` with caller client. That's fine. However, they don't check if the page is actually a page (they already did). But there is a potential issue: they use `supabaseClient.from('page_members').select('role').eq('page_id', documentId).eq('user_id', user.id).maybeSingle()`. If the row exists, they set `canRead = !!member`. But they don't check the role; any member can read? That's probably fine.

- However, there's a potential issue: The `supabaseClient` is initialized with the user's JWT, so RLS applies. If the user is not a member, the query might return null, but if RLS blocks the query, it might return an error? They don't handle error, but `maybeSingle` should return data null and error null if no row. If RLS blocks, it might still return null. That's okay.

- Another issue: The GET endpoint does not check if the version is actually associated with the given documentId. The storage path includes both, so if someone knows a versionId that belongs to a different document, they could access it if they have read access to that other document? Actually, they check read access for the `documentId` provided. If the versionId is from a different document, the storage path would be different, so download would fail (404). But what if the versionId is from the same document but they provided a different documentId? They would check access for the provided documentId, then download using that documentId and versionId. If the versionId doesn't exist under that documentId, 404. So no issue.

- However, there's a potential issue: The GET endpoint does not verify that the version exists in the `document_versions` table. It only checks storage. If a version is deleted from the table but the binary remains, someone could still access it if they know the ID. But that's an edge case; the binary would eventually be cleaned up. Not a major issue.

- Another issue: In the POST endpoint, they create the version record and upload the binary. They use `supabaseAdmin.storage.upload` for the binary, but they use `supabaseClient.from('document_versions').insert(...)` for the metadata. This is important: they insert the metadata using the caller client, which respects RLS. But they previously checked that the user is owner or editor. However, the insert might fail if RLS blocks the insert. They handle error. But note: they use `supabaseClient.from('document_versions').insert(...)`. The `document_versions` table likely has RLS policies that allow owners/editors to insert. That's fine.

- However, there is a potential issue: The order of operations: they insert the metadata first, then upload the binary. If the upload fails, they return 500, but the metadata record remains, leading to an orphaned record. The PR description says "rollback of DB inserts on storage failure" is one of the review objectives. In the original code, they uploaded first then inserted? Actually, in the original POST (before this PR), they uploaded first then inserted? Let's check the diff: In the original, they had:
```
// 3. Upload binary snapshot to Supabase Object Storage
const buffer = Buffer.from(base64State, 'base64')
const { error: uploadError } = await supabaseAdmin.storage
    .from('documents')
    .upload(`${documentId}/versions/${version.id}.bin`, buffer, {...})
if (uploadError) {...}
// 4. Update the document's latest version pointer
...
```
Wait, the diff shows they changed the order? Actually, in the new code, they do:
1. Create version record (insert).
2. Encrypt and upload.
If upload fails, they throw and return 500, but the version record is already inserted. That's a rollback issue. The original code might have had the same order? Let's see the diff context: The original code had sections "1. Verify user role", "2. Create the document_versions record", "3. Upload binary snapshot". So the order was the same: insert then upload. So the rollback issue existed before. However, the review objective is to verify API route safety, including rollback of DB inserts on storage failure. So we should flag this as a potential issue: if the storage upload fails, the version metadata record is left orphaned. The client would get a 500 error, but the record exists. This could cause inconsistencies. A fix would be to upload first, then insert, or use a transaction (but Supabase doesn't support transactions across storage and DB easily). Alternatively, delete the record on upload failure. The code currently doesn't do that. In the catch block, they just return 500. So we should flag this.

Let's check the catch block: In the POST, they have try/catch, and in catch they return 500. They don't attempt to delete the inserted version record. So yes, orphaned record.

- Another issue: In the POST, they use `supabaseClient.from('document_versions').insert(...).select(...).single()`. If the insert fails, they throw. But if the insert succeeds and the upload fails, they don't clean up. So that's a logic bug.

- Also, in the POST, they use `supabaseAdmin` for storage upload, but they use `supabaseClient` for insert. That's fine.

- In the GET endpoint, they use `supabaseAdmin.storage.download`. That's fine.

Now, `components/version-history.tsx`:
- They changed the save version flow to use the API endpoint `/api/version` POST instead of direct Supabase storage upload and DB insert. They also changed the preview and restore flows to use the GET endpoint.
- They added a `token` prop. They use `effectiveToken = token || session?.access_token`. That's fine.
- They send `base64State` in the POST body. The API endpoint expects `base64State`. Good.
- In the preview and restore, they fetch with Authorization header. Good.
- However, they don't handle the case where the API returns an error; they throw and catch. That's fine.

Potential issues:
- In the preview flow, they create a temporary Y.Doc and apply the update. They then set the editor to that state. That's fine.
- In the restore flow, they create a target Y.Doc and apply the update, then propagate updates. That's fine.
- But note: The component now uses `fetch` instead of `supabase.storage.download`. The GET endpoint returns the decrypted binary as `application/octet-stream`. The component then converts to `arrayBuffer` and creates `Uint8Array`. That's fine.
- However, the component does not check the `Content-Type` or handle errors gracefully beyond throwing. That's okay.

Now, `server/index.js`:
- They import `encryptSnapshot, decryptSnapshot` from `./crypto`.
- In `saveDocumentState`, they encrypt the state update before uploading. Good.
- In the persistence layer, they decrypt on load. Good.
- However, there's a potential issue: The `saveDocumentState` function is called from the sync server. It receives a `ydoc` and encodes state as update. But note: Y.encodeStateAsUpdate returns a Uint8Array? Actually, Y.encodeStateAsUpdate returns a Uint8Array. They pass it to `encryptSnapshot`, which expects `Buffer | Uint8Array`. In `server/crypto.js`, `encryptSnapshot` checks `Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)`. So if it's a Uint8Array, it will create a Buffer from it. That's fine. But in `server/index.js`, they do `const stateUpdate = Y.encodeStateAsUpdate(ydoc); const encryptedBuffer = encryptSnapshot(stateUpdate)`. `stateUpdate` is a Uint8Array, not a Buffer. That's fine.

- However, there is a subtle bug: In the persistence layer, they do:
```
const decrypted = decryptSnapshot(Buffer.from(arrayBuffer))
const uint8Array = new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
Y.applyUpdate(ydoc, uint8Array, 'supabase-load')
```
If the snapshot is not encrypted (legacy), `decryptSnapshot` returns the original buffer (which is a Buffer). Then they create a Uint8Array view. That's fine. But note: `Buffer.from(arrayBuffer)` creates a Buffer that copies the data? Actually, `Buffer.from(arrayBuffer)` creates a Buffer that views the arrayBuffer if it's a Uint8Array? Wait, `Buffer.from(arrayBuffer)` where `arrayBuffer` is an ArrayBuffer (from `data.arrayBuffer()`), it creates a Buffer that copies the data? Actually, `Buffer.from(arrayBuffer)` creates a Buffer that is a view of the ArrayBuffer? Let's recall: `Buffer.from(arrayBuffer)` returns a Buffer that shares the memory with the ArrayBuffer? According to Node.js docs, `Buffer.from(arrayBuffer)` returns a Buffer that views the given ArrayBuffer, but it might throw if the ArrayBuffer is not a Uint8Array? Actually, `Buffer.from(arrayBuffer)` accepts an ArrayBuffer or ArrayBufferView. If it's an ArrayBuffer, it creates a Buffer that views the memory. However, the `data.arrayBuffer()` returns an ArrayBuffer. So `Buffer.from(arrayBuffer)` creates a Buffer view. That's fine. Then `decryptSnapshot` returns a Buffer (either the same or a new one). Then they create a Uint8Array from the decrypted Buffer's underlying buffer. That's fine.

- But there is a potential issue: In the persistence layer, they do `if (data) { ... } else if (error && error.status !== 404) { ... }`. If the download returns a 404, they ignore. That's fine.

- However, what about the case where the snapshot is encrypted but the decryption fails? It will throw, and the error will propagate. The persistence layer might not catch it? The `setPersistence` callback might handle errors? Let's look at the context: In `server/index.js`, the persistence layer is set up with `setPersistence({ ... })`. The load function is called when a document is loaded. If it throws, the WebSocket connection might crash. That's a potential issue: if a document's snapshot is corrupted or decryption fails (e.g., key rotation issue), the sync server will crash when trying to load that document. This could be a HIGH severity issue because it could take down the sync server for all users. The load function should catch decryption errors and treat them as a missing snapshot (log and fall back to empty state). Currently, it doesn't. Let's check the code: In the diff, they have:
```
try {
    console.log(`[Persist] Loading document ${documentId}...`)
    const { data, error } = await supabaseAdmin.storage
        .from('documents')
        .download(`${documentId}/main_state.bin`)

    if (data) {
        const arrayBuffer = await data.arrayBuffer()
        const decrypted = decryptSnapshot(Buffer.from(arrayBuffer))
        const uint8Array = new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength)
        Y.applyUpdate(ydoc, uint8Array, 'supabase-load')
        console.log(`[Persist] Base state applied for ${documentId}`)
    } else if (error && error.status !== 404) {
        console.error(`[Persist] Failed to load document ${documentId}:`, error)
    }
} catch (err) {
    console.error(`[Persist] Error loading document ${documentId}:`, err)
}
```
Wait, they do have a try/catch around the whole block? Let's check the diff: The diff shows the code inside `setPersistence({ ... })`. The original code had a try/catch? Let's look at the diff context: The original code likely had a try/catch. The diff shows:
```
-		// 1. Fetch base Yjs state from Supabase Storage
+		// 1. Fetch base Yjs state from Supabase Storage and
