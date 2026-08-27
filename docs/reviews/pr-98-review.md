# Code Review: PR #98 - feat(editor): render wikilinks as resolved interactive link chips (#92)

**Reviewer**: Clean-Room OpenRouter (z-ai/glm-5.2:free)
**Date**: 2026-08-26T20:21:32.478Z

We are reviewing the PR: feat(editor): render wikilinks as resolved interactive link chips (#92)

We are to check for:
1. Logical bugs, concurrency race conditions, memory leaks, state corruption.
2. ADR 0001 compliance (Snapshot encryption at rest with AES-256-GCM, LK_ENC_V1 header, fallback key rotation, no plaintext in Supabase Storage).
3. ADR 0004 compliance (Server-hub CRDT sync topology, non-destructive additive merges).
4. Privacy boundaries (no note titles, plaintext bodies, or markdown leaked in analytics payloads).
5. API route safety (payload size limits, authentication/RLS checks, rollback of DB inserts on storage failure).

We note that the PR does not touch:
- Encryption (ADR 0001) directly: it's about rendering wikilinks in the editor.
- Sync topology (ADR 0004) directly: it's a client-side feature that relies on the existing CRDT and sync mechanism.
- Analytics payloads: we don't see any analytics code in the diff.
- API routes: the PR uses existing services (fetchPageDetails, fetchWorkspacePages, createPage) and does not modify the server.

However, we must check for:
- Logical bugs in the wikilink feature.
- Concurrency issues (since it's a collaborative editor).
- Memory leaks (e.g., in the useEffect that sets workspacePages).
- State corruption (e.g., if the wikilink decorations are not updated correctly).

Let's break down the changes:

1. In `components/editor-workspace.tsx`:
   - Added imports: `toast` from 'sonner', `fetchWorkspacePages`, `createPage` from '@/services/graph', and `Wikilink` from '@/lib/wikilink'.
   - Added state variables: `workspaceId` and `workspacePages`.
   - In the `useEffect` that runs on `pageId` change, added a call to `loadWorkspacePages` which fetches the workspace pages and sets the state.
   - Added two callbacks: `handleNavigateToPage` and `handleCreateWikilinkPage`.
   - Modified the `getSharedExtensions` mapping to conditionally configure the `Wikilink` extension with the workspace pages and callbacks.
   - Added a `useEffect` that runs when `editor` and `workspacePages` change to set the workspace pages in the editor via `editor.commands.setWorkspacePages(workspacePages)`.

2. In `lib/editor-extensions.ts`:
   - Imported `Wikilink` from '@/lib/wikilink'.
   - Added `Wikilink` to the list of shared extensions.

3. New file `lib/wikilink.ts`:
   - Implements the Wikilink Tiptap extension.
   - Includes:
        - Regex for parsing wikilinks.
        - Functions to normalize targets and parse wikilinks in text.
        - Function to create decorations for resolved and unresolved wikilinks.
        - A Tiptap extension that:
            - Stores workspace pages and a map (normalized title to page summary).
            - Provides a command to set workspace pages (which updates the storage and triggers a plugin state update).
            - Adds a ProseMirror plugin that:
                - Initializes decorations based on the current document and pagesMap.
                - Updates decorations on transaction (if doc changed or metadata set) by recreating decorations.
                - Handles clicks on wikilink decorations: if resolved, navigates to the page; if unresolved, creates the page and navigates.

4. New test file `tests/unit/wikilink.test.ts`:
   - Unit tests for the wikilink parsing, normalization, decoration creation, and dynamic updates.

Now, let's check for issues:

### Potential Issues:

#### 1. Logical Bugs / Race Conditions:

   a) In `editor-workspace.tsx`:
      - The `loadWorkspacePages` function is called whenever `pageId` changes. It fetches the page details to get the `workspace_id`, then fetches the workspace pages.
      - However, note that the `pageId` might be for a page that is not in the current workspace? Actually, the pageId is for the page being edited, and it should belong to a workspace. But what if the page is not found? The function does not handle the case when `details` is null or undefined. We see:
            const details = await fetchPageDetails(pageId)
            if (details?.workspace_id) { ... }
        So if `details` is null, we skip. But if `details` exists but `workspace_id` is null? Then we skip. That's acceptable.

      - However, there is a potential race condition: if the `pageId` changes rapidly, we might have multiple requests for `fetchPageDetails` and `fetchWorkspacePages` in flight. The state updates (`setWorkspaceId` and `setWorkspacePages`) might be overwritten by an older request. This is a common issue in React when dealing with asynchronous data fetching in effects.

        Example: 
          - User navigates to page A (workspaceId: ws1) -> starts loading workspace pages for ws1.
          - Before that finishes, user navigates to page B (workspaceId: ws2) -> starts loading workspace pages for ws2.
          - The request for ws1 might finish after the request for ws2, setting the workspace pages to ws1's pages when the user is actually viewing a page in ws2.

        This could lead to showing wikilink resolutions from the wrong workspace.

        Fix: We should cancel the previous request or use a mechanism to ignore stale responses. We can use an AbortController or simply track the latest pageId for which we are fetching.

        Alternatively, we can move the fetching of workspace pages to be based on the workspaceId (which we get from the page details) and then only update if the workspaceId matches the current one we are interested in.

        However, note that we are setting the workspaceId in the state. We can compare the workspaceId from the details with the current state's workspaceId? But we are setting it in the same effect.

        Better: We can store the `pageId` that triggered the request and ignore the response if it doesn't match the current pageId.

        Let's adjust the effect:

          useEffect(() => {
            if (!pageId) return;

            let isCurrent = true;
            const loadWorkspacePages = async () => {
              try {
                const details = await fetchPageDetails(pageId);
                if (!isCurrent) return;
                if (details?.workspace_id) {
                  setWorkspaceId(details.workspace_id);
                  const pages = await fetchWorkspacePages(details.workspace_id);
                  if (!isCurrent) return;
                  const summaries: WorkspacePageSummary[] = pages.map(p => ({ id: p.id, title: p.title }));
                  setWorkspacePages(summaries);
                }
              } catch (err) {
                if (!isCurrent) return;
                console.error('Error fetching workspace pages for wikilinks:', err);
              }
            };

            loadWorkspacePages();

            return () => {
              isCurrent = false;
            };
          }, [pageId]);

        This way, if the component unmounts or the pageId changes before the request finishes, we ignore the response.

   b) In the same file, the `useEffect` that sets the workspace pages in the editor:

          useEffect(() => {
            if (editor && workspacePages.length > 0) {
              editor.commands.setWorkspacePages(workspacePages);
            }
          }, [editor, workspacePages]);

        This effect runs whenever `editor` or `workspacePages` changes. However, note that `workspacePages` might be an empty array initially, and then we set it to the fetched pages. This is okay.

        But what if the workspacePages change while the user is editing? We update the editor's command, which in turn updates the Wikilink extension's storage and triggers a redecorations. This is intended.

        However, note that the `setWorkspacePages` command in the Wikilink extension does:

          if (dispatch) {
            this.storage.workspacePages = pages;
            const map = new Map<string, WorkspacePageSummary>();
            for (const p of pages) {
              map.set(normalizeWikilinkTarget(p.title), p);
            }
            this.storage.pagesMap = map;
            tr.setMeta(wikilinkPluginKey, { pages });
          }

        This updates the storage and then sets a metadata on the transaction. The plugin's `apply` function will see the metadata and recreate the decorations.

        This is safe.

   c) In `lib/wikilink.ts`:
        - The `parseWikilinksInText` function uses a global regex (`WIKILINK_REGEX`). It sets `lastIndex` to 0 at the beginning and then uses `exec` in a loop. This is safe because it's a local variable and we are not sharing the regex across threads (JavaScript is single-threaded). However, note that if this function is called concurrently (which it isn't in the main thread) it would be unsafe. But since we are in a single-threaded environment and the function is called synchronously during decoration creation, it's okay.

        - The `createWikilinkDecorations` function iterates over the document's text nodes and for each, parses the wikilinks and creates decorations. This is done synchronously and should be fast enough for typical note sizes.

        - The plugin's `handleClick` function: 
            - It prevents the default event and then calls either `onNavigateToPage` or `onCreatePage`.
            - We must ensure that these callbacks are defined. In the editor-workspace, we are passing them, so they are defined.

        - However, note that the `onCreatePage` callback in `editor-workspace.tsx` uses `toast` and `router.push`. These are client-side and safe.

#### 2. ADR 0001 Compliance:

        The PR does not touch encryption, storage, or server-side code. It is purely a client-side rendering feature. Therefore, it does not affect ADR 0001.

        However, note that the wikilink feature relies on having the workspace pages (titles and ids) in the client. This data is fetched via `fetchWorkspacePages` which likely comes from the server. We must ensure that this data is not sensitive in a way that violates privacy.

        The data fetched is: page id and title. According to the domain spec, page titles are not considered sensitive enough to encrypt in the default mode (since the default is encrypted at rest with server-held keys, and the server needs to index for search and graph). So exposing the titles in the client for the purpose of wikilink resolution is acceptable.

        But note: the PR does not encrypt the workspace pages in the client's memory. However, that is not required by ADR 0001 because ADR 0001 is about encryption at rest (on the server). The client is allowed to have plaintext for its own replica.

        Therefore, no ADR 0001 violation.

#### 3. ADR 0004 Compliance:

        The PR does not change the sync topology. It relies on the existing Yjs CRDT and the server-hub model.

        However, we must check that the wikilink feature does not break the CRDT properties.

        The wikilink feature only adds decorations (which are not stored in the document) and does not change the document content. The document content remains the plain text with the wikilink syntax (e.g., `[[target]]`). 

        This is important because:
          - The underlying ProseMirror document stores the literal `[[wikilink]]` (as stated in the PR description).
          - Therefore, when the document is synced via Yjs, only the plain text is transmitted and stored. The decorations are purely client-side and are recalculated from the document content and the workspace pages (which are also synced?).

        But note: the workspace pages are fetched from the server and stored in client state. They are not part of the Yjs document. Therefore, if two clients have different sets of workspace pages (because they are in different workspaces, or because one has not yet fetched the pages), they might render the same wikilink differently (one resolved, one unresolved). However, this is acceptable because:
          - The workspace pages are specific to the workspace. The editor is for a specific page in a specific workspace, so the workspace pages should be the same for all clients in that workspace.
          - We are fetching the workspace pages for the workspace of the current page.

        However, there is a potential issue: the workspace pages might be out of date if the workspace changes (e.g., a page is renamed or added) and the client hasn't refetched. We have an effect that refetches when the `pageId` changes, but not when the workspace pages change independently.

        We are setting the workspace pages in the editor via `editor.commands.setWorkspacePages(workspacePages)` whenever the `workspacePages` state changes. This will cause the Wikilink extension to update its decorations.

        But how do we update the `workspacePages` state when the workspace changes (e.g., a page is added by another user)? 

        Currently, we only fetch the workspace pages when the `pageId` changes. We do not have a subscription to workspace page changes.

        This means that if another user adds a page to the workspace while we are editing, we won't see it until we navigate away and back (or until we refetch for some other reason).

        This is a staleness issue, but it does not break the CRDT or cause data loss. It just means the wikilink resolution might be temporarily incorrect.

        However, note that the PR description says: "Dynamic Updates: Automatically recalculates decorations whenever workspace pages load or change." 

        We are only recalculating when the `workspacePages` state changes (which we set from the effect that runs on `pageId` change) and when the editor's document changes (via the plugin). We are not recalculating when the workspace pages change on the server.

        To fully satisfy "whenever workspace pages load or change", we would need to subscribe to workspace page changes. But that is beyond the scope of this PR? 

        However, note that the workspace pages are not stored in the Yjs document, so we cannot rely on Yjs to sync them. We would need a separate mechanism (like a query subscription) to update the workspace pages.

        Since the PR does not implement such a subscription, we note this as a limitation but not a bug in the current implementation because the PR does not claim to have real-time updates for workspace pages. The PR says: "Automatically recalculates decorations whenever workspace pages load or change" — and we are doing that for the initial load and when the pageId changes (which might happen when navigating to a different page in the same workspace? but not when the workspace changes while on the same page).

        We can consider this a medium issue: the wikilink resolutions may become stale if the workspace is modified by another user while the page is open.

        However, note that the workspace pages are also used for mentions (via the `mentionables` state). We see that the `mentionables` are fetched in a similar way (on `pageId` change) and do not have real-time updates either. So this is consistent with the existing code.

        Therefore, we do not consider this a blocker for this PR.

#### 4. Privacy Boundaries:

        The PR does not introduce any analytics or data leakage. The wikilink feature only uses the workspace pages (titles and ids) to create decorations and to handle clicks (which then navigate or create a page). 

        We are not sending any data to analytics endpoints. Therefore, no privacy boundary violation.

#### 5. API Route Safety:

        The PR uses existing API routes: `fetchPageDetails`, `fetchWorkspacePages`, `createPage`. We are not modifying these routes. 

        However, we should check that we are using them correctly:

        - `fetchPageDetails(pageId)`: we are using it to get the workspace_id. We assume this endpoint is protected and returns the page details only if the user has access.

        - `fetchWorkspacePages(workspaceId)`: we are fetching all pages in the workspace. This could be a lot of data if the workspace is large. We are only extracting the id and title, but we are still fetching the entire page objects (as per the service). 

          The service `fetchWorkspacePages` might be returning more data than we need (like content, etc.). We are only using id and title. 

          This could be a performance issue (medium) but not a safety issue.

        - `createPage(workspaceId, currentUser.id, null, { title: targetTitle })`: we are creating a page with the given title. We are not checking the length of the title or any other constraints. However, the backend should have validation.

        We are not seeing any payload size limits being checked on the client. But note that the wikilink target is coming from the user input in the editor. The user could type a very long string in a wikilink. 

        However, the wikilink is limited by the fact that it is in the document. The document size is already limited by the editor and the sync system. 

        We are not introducing a new API route, so we rely on the existing ones.

        Therefore, no new API route safety issues.

### Memory Leaks:

        In `editor-workspace.tsx`:
          - We are setting up two effects that run on `pageId` change. The first effect (for mentionables) already existed and we added a second one for workspace pages. 
          - The second effect does not return a cleanup function. We discussed above that we should add a cleanup to ignore stale responses.

          Without cleanup, we might set state on an unmounted component (which React warns about) and also we might have the race condition issue.

          We fixed the race condition by adding a cleanup that sets a flag to ignore stale responses. But note: we did not see a cleanup in the current code. We must add one.

        Also, note that the `useEffect` that sets the workspace pages in the editor:

          useEffect(() => {
            if (editor && workspacePages.length > 0) {
              editor.commands.setWorkspace
