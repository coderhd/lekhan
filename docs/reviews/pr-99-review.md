### 🤖 Lekhan Independent Clean-Room Review (z-ai/glm-5.2:free)

We are reviewing the Pull Request for feat(history): local-first Git-style version history & tier enforcement (#82)

We must check for:
1. Logical bugs, concurrency race conditions, memory leaks, state corruption.
2. ADR 0001 compliance (Snapshot encryption at rest with AES-256-GCM, LK_ENC_V1 header, fallback key rotation, no plaintext in Supabase Storage).
3. ADR 0004 compliance (Server-hub CRDT sync topology, non-destructive additive merges).
4. Privacy boundaries (no note titles, plaintext bodies, or markdown leaked in analytics payloads).
5. API route safety (payload size limits, authentication/RLS checks, rollback of DB inserts on storage failure).

We'll go through the changes and note any issues.

First, note that the PR introduces a lot of new code for version history and tier enforcement.

Let's break down by area:

## 1. Version History Engine (lib/version-history/engine.ts)

### Potential Issues:

a) **Memory Leak / State Corruption in restoreCheckpoint**:
   - In `restoreCheckpoint`, we are iterating over `targetYdoc.share.entries()` and for each type, we are deleting the entire content and then inserting the content from the snapshot.
   - However, note that the Y.Doc might have types that are not covered by the if-else chain (e.g., Y.XmlElement, Y.XmlFragment are covered, but what about Y.XmlAttribute?).
   - Also, note that the Y.Doc might have types that are not in the share map at the time of restore? But we are iterating over the current share.

   More importantly, the way we are restoring is by deleting and then inserting. This is destructive to the current state? But note: we are restoring to a past state and then creating a new checkpoint. The requirement is non-destructive: we must not overwrite prior history. The current method does not delete the prior history because we are creating a new checkpoint after restoring. However, the restore operation itself is destructive to the current Y.Doc (we are replacing its content). But that is the point of restore: to set the current state to a past state. The non-destructive aspect is that we record a new checkpoint so that the user can go forward again.

   However, note that the restore operation in the engine does:
   ```typescript
   targetYdoc.transact(() => {
        for (const [key, type] of targetYdoc.share.entries()) {
            ... // delete and insert from tempDoc
        }
   }, authorId)
   ```
   This will remove any type that is in the targetYdoc but not in the tempDoc? Actually, no: we are iterating over the targetYdoc's share. If a type exists in targetYdoc but not in tempDoc, we delete it (by setting its length to 0 and not inserting anything). Similarly, if a type exists in tempDoc but not in targetYdoc, we don't handle it because we are only iterating over targetYdoc's share.

   This is a problem: we are not adding new types that were in the snapshot but not in the current document.

   Example: Suppose in the snapshot we had a Y.Map at key 'meta' but in the current document we don't have that key. Then in the restore, we would not create the 'meta' map because we are only iterating over the current document's share (which doesn't have 'meta'). So the restored document would be missing the 'meta' map.

   Similarly, if the current document has a type that the snapshot doesn't have, we delete it (which is correct for restoring to the snapshot) but we don't add the types that are in the snapshot and not in the current.

   Therefore, the restore operation is incomplete.

   We should instead:
   - Clear the targetYdoc (remove all types) and then apply the update from the snapshot? But note: Yjs does not allow removing types arbitrarily? Actually, we can delete the content of each type, but we cannot remove the type itself from the Y.Doc without deleting the type.

   Alternatively, we can create a new Y.Doc from the snapshot and then replace the targetYdoc's content? But note: we are transacting and we want to preserve the Y.Doc identity (so that other clients don't see a new doc). The Y.Doc identity is important for awareness and undo history? Actually, in Yjs, the Doc is identified by its clientID. We cannot change the clientID of an existing Doc.

   The correct way to restore a Y.Doc to a snapshot is to:
   1. Encode the snapshot as an update.
   2. Apply that update to the targetYdoc (which will merge the changes). But note: applying an update is additive. It will not remove content that is in the targetYdoc and not in the snapshot.

   However, we want to set the targetYdoc to exactly the snapshot state. We cannot do that by applying an update because Yjs updates are additive and merge concurrently.

   Therefore, the common practice is to:
   - Create a temporary Y.Doc from the snapshot.
   - Then, for each type in the targetYdoc, we delete its content and then insert the content from the temporary Y.Doc for the same key (if it exists) or leave it deleted (if it doesn't exist in the snapshot). But note: we also need to add types that are in the snapshot but not in the targetYdoc.

   So we must:
   - Iterate over all keys in the temporary Y.Doc and the targetYdoc? Actually, we can do:

   Step 1: Delete all content in the targetYdoc (by iterating over its share and clearing each type).
   Step 2: Then, for each type in the temporary Y.Doc, we get the type by key and insert its content into the targetYdoc at the same key.

   However, note: the Y.Doc does not allow creating a type with a key that already exists? Actually, if we delete the type (by clearing its content) the type still exists. We cannot remove the type from the Y.Doc's share? We can only clear its content.

   Therefore, we cannot add a new type (with a key that doesn't exist in the targetYdoc) by this method.

   The Y.Doc's share is a map that we cannot modify arbitrarily? We can only add types by creating them (e.g., `ydoc.getText('key')` creates a Y.Text if it doesn't exist). So we can do:

   - Clear the targetYdoc: for each type in targetYdoc.share, clear its content (set to empty).
   - Then, for each key in the temporary Y.Doc's share, we get the type from the temporary Y.Doc and then insert its content into the targetYdoc (by getting or creating the type in targetYdoc for that key and then inserting the content).

   But note: the temporary Y.Doc might have types that are not in the targetYdoc's share. We can create them in the targetYdoc by accessing them (e.g., `targetYdoc.getText(key)` for a Y.Text).

   However, we don't know the type of each key in the temporary Y.Doc. We can use the Y.Doc's `get` method? Actually, we can use the temporary Y.Doc's share to know the type? But note: the share map only contains the top-level types. We are only storing top-level types in our version history? In the engine, we are storing the entire Y.Doc state as an update. When we apply the update to a temporary Y.Doc, we get a Y.Doc that has the same structure as the original.

   Therefore, we can do:

   ```typescript
   targetYdoc.transact(() => {
        // Step 1: Clear all existing types in targetYdoc
        for (const [key, type] of targetYdoc.share.entries()) {
            if (type instanceof Y.Text) {
                type.delete(0, type.length);
            } else if (type instanceof Y.Map) {
                type.clear();
            } else if (type instanceof Y.Array) {
                type.delete(0, type.length);
            } else if (type instanceof Y.XmlElement) {
                type.delete(0, type.length);
            } else if (type instanceof Y.XmlFragment) {
                type.delete(0, type.length);
            }
            // Note: Y.XmlAttribute is not a top-level type? It is contained within an XmlElement.
        }

        // Step 2: Copy all types from tempDoc to targetYdoc
        for (const [key, type] of tempDoc.share.entries()) {
            const targetType = targetYdoc.get(key);
            if (type instanceof Y.Text) {
                const text = type.toString();
                if (text.length > 0) {
                    targetType.insert(0, text);
                }
            } else if (type instanceof Y.Map) {
                for (const [k, v] of type.entries()) {
                    targetType.set(k, v);
                }
            } else if (type instanceof Y.Array) {
                const arr = type.toArray();
                if (arr.length > 0) {
                    targetType.insert(0, arr);
                }
            } else if (type instanceof Y.XmlElement) {
                const children = type.toArray().filter(el => el instanceof Y.XmlElement || el instanceof Y.XmlText);
                if (children.length > 0) {
                    targetType.insert(0, children.map(el => el.clone()));
                }
            } else if (type instanceof Y.XmlFragment) {
                const children = type.toArray().filter(el => el instanceof Y.XmlElement || el instanceof Y.XmlText);
                if (children.length > 0) {
                    targetType.insert(0, children.map(el => el.clone()));
                }
            }
        }
   }, authorId);
   ```

   However, note that the current code in the PR does not do step 1 for all types (it does delete the content) but then only inserts if the type exists in the targetYdoc (by getting it from targetYdoc). It does not handle types that are in the tempDoc but not in the targetYdoc.

   Therefore, the current restore operation is broken for adding new types.

   This is a **logic bug** that could lead to state corruption (missing data after restore).

   We must fix the restoreCheckpoint method to properly restore the entire state.

b) **Potential race condition in engine**:
   - The engine uses a storage adapter. The IndexedDBHistoryAdapter and MemoryHistoryAdapter are not thread-safe? But note: in the browser, JavaScript is single-threaded. However, we are using async/await and there might be multiple operations happening concurrently (e.g., multiple checkpoints being saved at the same time). The adapters do not have any locking mechanism.

   For IndexedDB, we are using the `idb` library which is promise-based and handles transactions. However, note that the `pruneAutoCheckpoints` method in IndexedDBHistoryAdapter reads all checkpoints, then deletes them one by one. Between the read and the delete, new checkpoints might be added. This could lead to not pruning enough or pruning too much.

   Similarly, the `saveCheckpoint` and `pruneAutoCheckpoints` are not atomic.

   This could lead to the storage exceeding the quota temporarily, or pruning more than intended.

   However, note that the `createAutoCheckpoint` method does:
   ```typescript
   await this.storageAdapter.saveCheckpoint(checkpoint)
   if (maxStorageBytes !== undefined) {
        await this.storageAdapter.pruneAutoCheckpoints(pageId, maxStorageBytes)
   }
   ```
   So after saving, we prune. But if two auto-checkpoints are created concurrently, we might have:
   - Thread A: saves checkpoint A
   - Thread B: saves checkpoint B
   - Thread A: prunes (sees A and B, and if over limit, deletes the oldest until under limit)
   - Thread B: prunes (sees A and B, and if over limit, deletes the oldest until under limit)

   This could lead to deleting more than necessary, but it should eventually be under the limit. However, it is inefficient and might delete a checkpoint that was just saved.

   We should consider making the save and prune atomic? But IndexedDB doesn't support transactions across multiple object stores easily? We are only using one object store.

   Alternatively, we can change the prune method to be called in a way that it is the only operation happening? But we cannot guarantee that.

   This is a potential issue but might be acceptable given the low frequency of auto-checkpoints (every 15 minutes) and the fact that the prune is done after each save.

   However, note that the `createMilestone` method does not call prune. So milestones (pinned) are never pruned by the engine. The prune is only for auto-checkpoints.

   The requirement says: "rolling automated snapshots with quota-based LRU pruning". So only auto-checkpoints are subject to pruning.

   The current implementation in the engine for `createAutoCheckpoint` does prune after saving. But note: the prune method in the adapter (for IndexedDB) does:
   ```typescript
   const unpinned = checkpoints
        .filter(cp => !cp.isPinned)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
   ```
   and then deletes from the oldest until under the limit.

   This is correct for LRU (least recently used) if we consider the oldest as least recently used? Actually, we are sorting by createdAt ascending (oldest first) and then deleting from the beginning. So we are deleting the oldest auto-checkpoints first. That is LRU.

   However, note: the checkpoint might be updated? We don't update checkpoints, we only create new ones. So the createdAt is the time of creation.

   So the prune logic is correct.

   But the concurrency issue remains: if two saves happen at the same time, we might have two checkpoints saved and then two prune operations. The first prune might see two checkpoints and delete one (if over limit) and the second prune might see one checkpoint and do nothing. But if the limit is very low (say 100 bytes) and each checkpoint is 60 bytes, then:
   - Initially: 0 bytes
   - Save A: 60 bytes -> then prune: 60 <= 100 -> do nothing.
   - Save B: 120 bytes -> then prune: sees A and B (total 120) -> deletes A (oldest) -> now 60 bytes.

   This is correct.

   However, if the saves happen at the exact same time (within the same event loop tick) then we might have:
   - Both saves happen before either prune.
   - Then both prunes run: each sees two checkpoints and deletes the oldest (which is the same one) -> so we delete the same checkpoint twice? But the second delete will fail because it's already deleted.

   We should make the prune operation resilient to missing checkpoints? In the IndexedDB adapter, `delete` will throw if the key doesn't exist? Actually, the `idb` library's `delete` method does not throw if the key doesn't exist? Let me check: the `idb` library's `delete` method returns a promise that resolves to undefined. It does not throw if the key doesn't exist.

   So it is safe.

   Therefore, the concurrency issue might not be a problem.

   However, note that the `listCheckpoints` method in the adapter is not transactional with respect to the saves that might be happening concurrently. But we are using `idb` which uses transactions. The `getAllFromIndex` is done in a transaction? Yes, because we are using the `idb` library which creates a transaction for each operation.

   But note: we are doing multiple operations (getAllFromIndex, then multiple deletes) in the prune method without a transaction. So between the getAllFromIndex and the deletes, new checkpoints might be added.

   This could lead to:
   - We read the checkpoints (say total 150 bytes, limit 100)
   - Then a new checkpoint is saved (now 210 bytes)
   - We then delete the oldest auto-checkpoints until we are under 100 bytes (based on the old list) -> we might delete two checkpoints (from the old list) and then the total becomes 210 - (size of two deleted) = 210 - 120 = 90 -> which is under 100, but note we added one in between so we have 90 + 60 (the new one) = 150? Actually, no: the new checkpoint was added after we read, so when we delete we are deleting from the list we read (which didn't include the new one). Then we have:
        original list: [A, B, C] (total 150)
        new checkpoint D is added (so now we have A, B, C, D -> 210)
        We delete A and B (the two oldest from the original list) -> now we have C and D -> 120 bytes -> still over limit.

   So we failed to prune enough.

   To fix this, we should make the entire prune operation atomic? We can do a transaction that:
   - Reads the checkpoints (ordered by createdAt, unpinned only)
   - Computes which ones to delete
   - Deletes them

   But note: the `idb` library does not allow us to do a transaction that spans multiple operations in the way we want? Actually, we can do:

   ```typescript
   await db.transaction('rw', db.objectStoreNames.contains(STORE_NAME) ? STORE_NAME : [], async () => {
        const store = db.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        // ... get all unpinned checkpoints sorted by createdAt ascending
        // ... then delete the ones we want to delete
   });
   ```

   However, note that we are also filtering by `pageId` and `isPinned`. We can do:

   We can change the prune method to use a transaction and do:

   ```typescript
   async pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number> {
        const db = await this.getDB();
        return await db.transaction('rw', db.objectStoreNames.contains(STORE_NAME) ? STORE_NAME : [], async () => {
            const store = db.objectStore(STORE_NAME);
            const index = store.index('createdAt');
            // We want to get all checkpoints for this pageId that are not pinned, sorted by createdAt ascending
            // But note: we have an index on 'pageId' and 'isPinned'. We can use a compound index? We don't have one.
            // Alternatively, we can get all checkpoints for the pageId (using the pageId index) and then filter.
            const checkpoints = await store.getAllFromIndex('pageId', pageId);
            const unpinned = checkpoints
                .filter(cp => !cp.isPinned)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            let totalBytes = unpinned.reduce((sum, cp) => sum + cp.byteSize, 0);
            let prunedCount = 0;

            for (const cp of unpinned) {
                if (totalBytes <= maxStorageBytes) {
                    break;
                }
                await store.delete(cp.id);
                totalBytes -= cp.byteSize;
                prunedCount++;
            }

            return prunedCount;
        });
   }
   ```

   But note: the transaction will auto-commit if we don't throw? And if we throw, it will rollback.

   However, the current code does not use a transaction for the entire prune operation. We are doing:
   - getAllFromIndex (which is a transaction)
   - then a loop of deletes (each delete is a separate transaction)

   We should change it to a single transaction.

   Similarly, the `saveCheckpoint` method is already a single transaction? Because `db.put` is one operation in a transaction? Actually, the `idb` library's `put` method creates a transaction for that single operation.

   We are not required to make it atomic for the save, but for the prune we should.

   This is a **logic bug** that could lead to storage exceeding the quota.

   We must fix the pruneAutoCheckpoints method in the IndexedDBHistoryAdapter to use a single transaction.

   The MemoryHistoryAdapter does not have this issue because it's in-memory and single-threaded? But note: we are using async/await and there might be multiple operations queued. However, in JavaScript, if we are in the same thread, the operations are sequential. But note: we are using `await` so other tasks can run in between. So the same issue could occur in the MemoryHistoryAdapter? Let's see:

   In MemoryHistoryAdapter, `pruneAutoCheckpoints`:
   - We get the checkpoints (this.store.get(pageId) || [])
   - Then we compute totalBytes and then we loop to delete.

   Between the get and the loop, another checkpoint might be saved (by another async operation that is awaited). So we have the same problem.

   Therefore, we should also fix the MemoryHistoryAdapter to be atomic? But note: in JavaScript, we cannot have true parallelism, but we can have interleaving of async operations.

   We can make the entire method atomic by not yielding? But we are using `await` in the loop (for deleteCheckpoint). We cannot avoid yielding.

   Alternatively, we can collect the checkpoints to delete and then delete them in a loop without yielding? But the deleteCheckpoint method is async and we must await it.

   We can change the MemoryHistoryAdapter to not use async/await in the loop? But the interface requires async.

   We can do:

   ```typescript
   async pruneAutoCheckpoints(pageId: string, maxStorageBytes: number): Promise<number> {
        const checkpoints = this.store.get(pageId) || [];
        // ... compute the list of checkpoints to delete (without yielding)
        const toDelete = []; // list of ids to delete
        let totalBytes = 0;
        const unpinned = checkpoints
            .filter(cp => !cp.isPinned)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        for (const cp of unpinned) {
            totalBytes += cp.byteSize;
        }

        if (totalBytes <= maxStorageBytes) {
            return 0;
        }

        let bytesToRemove = totalBytes - maxStorageBytes;
        for (const cp of unpinned) {
            if (bytesToRemove <= 0) break;
            toDelete.push(cp.id);
            bytesToRemove -= cp.byteSize;
        }

        // Now delete all in toDelete without yielding in between? But we must await each delete.
        for (const id of toDelete) {
            await this.deleteCheckpoint(pageId, id);
        }

        return toDelete.length;
   }
   ```

   But note: between the time we compute the list and the time we delete, new checkpoints might be added. So we are still not safe.

   Therefore, we must lock the pageId for the duration of the operation? We don't have a locking mechanism.

   Given the complexity and the fact that auto-checkpoints are only every 15 minutes, and the prune is triggered after each auto-checkpoint save, the chance of conflict is low. However, to be correct, we should use a transaction in IndexedDB and for Memory we cannot easily do it without yielding.

   Since the Memory adapter is only for tests, we might leave it as is and note that tests might be flaky? But the tests for the adapter pass.

   However, we are required to fix logic bugs. We'll focus on the IndexedDB adapter because it's used in production.

   We'll change the IndexedDBHistoryAdapter's pruneAutoCheckpoints to use a single transaction.

   We'll also note that the MemoryHistoryAdapter is not used in production, so we can leave it for now? But to be safe, we should fix both.

   However, given the scope of the review, we note the issue and recommend fixing the IndexedDB adapter.

c) **Missing error handling in engine**:
   - In `restoreCheckpoint`, if the decompression fails, we throw an error. But note: the decompressSnapshot function might throw? We are not catching it. Similarly, the `Y.applyUpdate` might throw? We are not catching.

   We should catch and handle errors appropriately? But the method is async and the caller is expected to handle.

   However, note that the `restoreCheckpoint` method is called from the VersionDrawer's `handleRestore` which does:
   ```typescript
   const handleRestore = async () => {
        if (!selectedVersion) return
        const checkpoint = await engine.restoreCheckpoint({
            pageId,
            workspaceId,
            checkpointId: selectedVersion.id,
            targetYdoc: currentYdoc,
            authorName: currentUser.name,
            authorId: currentUser.id
        })
        if (onRestored) {
            onRestored(checkpoint)
        }
        loadVersions()
        setSelectedVersion(null)
   }
   ```
   And then it calls `onRestored` and then `loadVersions`. If an error occurs in `restoreCheckpoint`, it will be caught by the `catch` in the `engineRef.current?.createAutoCheckpoint` call? No, because we are not wrapping it in a try/catch.

   Actually, the `handleRestore` does not have a try/catch. So if an error occurs, it will be thrown and not caught, leading to an unhandled promise rejection.

   We should wrap the call in a try/catch and show an error to the user.

   But note: the `RestoreConfirmDialog` is open and we are waiting for confirmation. We should catch the error and then show an error toast and close the dialog? Or keep it open and show an error.

   This is a **medium** issue: unhandled error leading to potential silent failure.

   We'll note it.

## 2. Version Drawer UI (components/version-history/version-drawer.tsx)

### Potential Issues:

a) **Memory leak in useEffect**:
   - We have:
   ```typescript
   useEffect(() => {
        if (isOpen) {
            loadVersions()
            
            // Compute current text
            try {
                const type = currentYdoc.get('default')
                if (type instanceof Y.Text) {
                    setCurrentText(type.toString())
                } else if (type instanceof Y.XmlFragment) {
                    let text = ''
                    for (let i = 0; i < type.length; i++) {
                        const el = type.get(i)
                        if (el instanceof Y.XmlElement || el instanceof Y.XmlText) {
                            text += el.toString()
                        }
                    }
                    setCurrentText(text)
                }
            } catch (e) {
                console.error(e)
            }
        }
   }, [isOpen, pageId])
   ```
   This effect runs whenever `isOpen` or `pageId` changes. When the drawer is opened, we load versions and compute the current text.

   However, note that we are setting `setCurrentText` and `setSnapshotText` (in another effect) but we are not
