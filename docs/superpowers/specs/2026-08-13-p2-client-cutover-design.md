# P2 Design: Client Cutover onto the Pages Graph

**Date:** 2026-08-13
**Status:** Approved (design)
**Plan:** `docs/superpowers/plans/2026-08-15-p2-client-cutover.md` (follows writing-plans)
**Supersedes handover:** `.superpowers/sdd/2026-08-12-p1-pages-graph-foundation/HANDOVER.md` "Next steps #2" (P2 client cutover, `page_members` UI, parked role-fallback fix).

## 1. Goal

P1 (pages-graph foundation) shipped the `workspaces`/`pages`/`page_members`/`page_links`/`page_tags` schema, the graph index service, and pages-first server auth — but the client still reads and writes the legacy `documents`/`document_members`/`document_invitations`/`document_versions` tables via `services/db.ts`. P2 moves the entire client onto the pages data model so that:

- The app's data layer is the knowledge graph (pages as nodes), matching the strategy spec's substrate.
- The parked auth/RLS inconsistency (role fallback outranks page RLS) is resolved before the client starts writing through pages.
- New pages (which have no `documents` twin) work end-to-end: editor sync, storage, version history, sharing.

## 2. Decisions (locked)

1. **Minimal cutover scope.** Dashboard, editor, share modal, invitations, settings, and version history move onto pages + `page_members` + `page_invitations`. Only the legacy `createDocument` doc-cap (5-doc free limit) is retired with page creation. AI credits (`profiles.plan`, `used_credits`) and their enforcement are untouched — their retirement rides on the separate billing (Stripe/Razorpay) and AI-provider-registry H0 plans.
2. **New `page_invitations` table** mirroring the legacy `document_invitations` shape (email + token + status + role), so the existing invite/accept UX carries over unchanged.
3. **Page-only authority.** For pages, access = owner OR `page_members` OR public. All `document_members`/`source_document_id` branches are dropped from both RLS helpers and the sync server's role verification, so auth and RLS agree exactly.
4. **Editor URL becomes `/page/[id]`**, with `/doc/[id]` kept as a redirect (existing bookmarks, share links, and invite links keep working).
5. **Legacy tables stay in the database** as an inert rollback path; the documents-mirror write-throughs in `services/graph.ts` (`deletePage`, `updatePagePublicStatus`) are retained per the minimal-scope decision.
6. **No workspace UI in P2.** Every user has exactly one personal workspace (`workspaces.UNIQUE(owner_id)`); the client silently fetch-or-creates it (`ensureWorkspace`) before first page creation. Dashboard stays a flat page list.

## 3. Out of Scope (deferred)

- Global search, markdown import/export, Obsidian importer, i18n, AI provider registry, real billing, USD/INR pricing, docs site (remaining H0 items — each gets its own plan).
- Graph view + backlinks pane, daily notes, publish, comments, templates, desktop/mobile, Plugins API (H1).
- Retiring `profiles.plan`/`used_credits`, the credits ledger, and plan-limit enforcement (billing plan).
- Renaming `document_versions` to `page_versions` (table name stays; see Section 5 — only a `page_id` column is added).
- Workspace switcher, team workspaces, workspace members (H2).

## 4. Architecture

### 4.1 Data flow after cutover (pages-first, mirrors retained)

- **Read path (client):** all lists/detail queries hit `pages`, `page_members`, `page_invitations` through the anon client (`lib/supabase.ts`) under RLS. `documents`/`document_members`/`document_invitations` are no longer queried by the UI.
- **Write path (client):** page CRUD, member management, invites, public toggle via `services/graph.ts`. `updatePagePublicStatus` and `deletePage` keep their legacy documents-mirror writes (harmless, keeps the rollback path warm).
- **Sync path (server):** unchanged from P1 — pages-first in `verifyUserRole`/`getEntityOwner`; `saveDocumentState` indexes via `sync_page_graph`; storage uploads to `{entityId}/main_state.bin` in the `documents` bucket (page ids remain the storage keys). `verifyUserRole`'s page branch now reads **only** `page_members` (fix below).
- **Version history:** `document_versions` gains a nullable `page_id` FK; policies check pages first, documents fallback.

### 4.2 RLS/authority model after cutover (page = owner | page_members | public)

| Surface | Rule |
|---|---|
| `pages` select | `can_access_page(id)`: owner OR `is_public` OR page_members (documents branch removed) + anon `select_pages_public` |
| `pages` insert | owner AND owns the workspace (existing hardened policy) |
| `pages` update / delete | owner only |
| `page_members` select | `can_access_page(page_id)` |
| `page_members` insert | owner of page OR invitee self-insert with a matching pending `page_invitation` |
| `page_members` update | owner of page (NEW — role changes) |
| `page_members` delete | owner of page (existing) |
| `page_invitations` select | owner OR invitee (email match) |
| `page_invitations` insert | owner of page |
| `page_invitations` update | owner OR invitee (accept/decline) |
| `page_invitations` delete | owner of page |
| `page_links` select | from-only `can_access_page(from_page_id)` (existing) |
| `page_tags` select | `can_access_page(page_id)` (existing) |
| `document_versions` | pages-first: owner/member select; owner/editor insert; owner delete — documents fallback for legacy rows |
| Storage (`can_access_document_storage`) | select: doc owner/public/member OR page owner/public/page_members; insert/update: doc owner/editor OR page owner/page_members editor; delete: doc owner OR page owner |

### 4.3 Role-fallback fix (parked item, resolved)

`server/auth.js` `verifyUserRole` for a page entity:

- owner short-circuit (unchanged);
- `page_members` row → its role;
- **no live `document_members` fallback** (dropped — `page_members` is the sole page authority; matches `can_access_page`);
- authenticated non-member on a public page → `'viewer'` (fixes the WS-denial divergence where anon could read but a signed-in stranger could not connect);
- anonymous → `'viewer'` only if public (unchanged).

`getEntityOwner` remains pages-first with documents fallback so unmapped legacy ids still resolve during the transition. `getDocumentOwnerPlanLimit` unchanged (WS concurrency caps stay; plan-based limits are a billing-plan concern).

### 4.4 In-flight legacy invites

The foundation migration converts **pending** `document_invitations` rows whose `document_id` maps to a page (`pages.source_document_id = document_id`) into `page_invitations` rows (same role, token, invitee, inviter; status pending). Accepted/declined rows are left untouched. Legacy invite tokens in the wild therefore keep working through the page flow.

## 5. Components

### 5.1 Foundation (migration `20260815000000_page_only_authority.sql` + `server/auth.js`)

1. Rewrite `can_access_page`: owner OR `is_public` OR `page_members` (drop the `source_document_id`/`document_members` branch).
2. Restore the pages branch in `can_access_document_storage` (dropped by P1's `20260814000002` — without it, twin-less pages cannot touch the storage bucket, breaking editor persistence and version downloads): select = page owner OR public OR page_members; insert/update = page owner OR page_members role `editor`; delete = page owner. Documents branch unchanged.
3. `document_versions`: add `page_id UUID NULL REFERENCES pages(id) ON DELETE CASCADE`; rewrite `select_versions`/`insert_versions`/`delete_versions` to grant via pages first (select: owner/member; insert: owner/editor member; delete: owner), documents fallback.
4. New `page_invitations` table: `page_id` FK pages CASCADE, `inviter_id` FK profiles, `invitee_email`, `role member_role`, `token uuid default gen_random_uuid()`, `status invitation_status`, `created_at`; RLS per Section 4.2.
5. `page_members`: add owner-only update policy; extend insert policy with the invitee self-insert clause (pending `page_invitation` for their email).
6. Backfill: pending `document_invitations` → `page_invitations` via `pages.source_document_id` mapping.
7. `server/auth.js` `verifyUserRole`: page-only authority + public-page viewer for authenticated strangers (Section 4.3). `server/index.js` unchanged.

### 5.2 Client service layer (`services/graph.ts`, `types/index.ts`)

New exported functions (all through the `lib/supabase.ts` anon client, throwing on error, matching the existing style):

- `ensureWorkspace(userId)` → fetch the user's workspace; insert `{owner_id: userId}` if missing; return it.
- `fetchSharedPages(userId)` → `page_members` joined with pages (role + page embed) for the user.
- `fetchPageMemberRole(pageId, userId)` → `'owner' | 'editor' | 'viewer' | null`.
- `fetchPageMembers(pageId)` → members with profile embed (avatar, full_name, email).
- `removePageMember(pageId, userId)`.
- `updatePageMemberRole(pageId, userId, role)`.
- `createPageInvitation(pageId, inviterId, inviteeEmail, role, token)` with pending-invite counting for the collaborator limit (mirroring the legacy `createInvitation` behavior; limit source remains `profiles.plan` until billing lands).
- `fetchPendingPageInvitations(email)` → with page title embed.
- `acceptPageInvitation(invite, userId)` → insert `page_members` + mark accepted (same transaction semantics as legacy: sequential writes, invitee self-insert relies on the new policy).
- `declinePageInvitation(inviteId)`.
- `fetchPageInvitationDetails(token)` → with page title + inviter profile embed.
- `fetchMentionablePageCollaborators(pageId)` → owner + page_members (role `editor`) with profile embed, for @mentions.
- `fetchOwnedPagesWithMembers(userId)` → owned pages + embedded `page_members` with profiles (settings tab).

Types: `PageMember` (`id`, `page_id`, `user_id`, `role: 'owner' | 'editor' | 'viewer'`, `created_at`, `profiles?`), `PageInvitation` (mirror `DocumentInvitation` with `page_id`), and add `workspace_id` to `PageLink`. `services/db.ts` keeps only the still-used helpers (AI credits + plan limits); document CRUD/collab functions stay in the file but are no longer imported by the UI.

### 5.3 Dashboard (`components/dashboard.tsx`)

- "My pages": `ensureWorkspace` → `fetchWorkspacePages(workspace.id)`; rename via `updatePageTitle`; delete via `deletePage`; navigate to `/page/${id}`.
- "Shared": `fetchSharedPages`.
- Create: `createPage(workspace.id, userId)` — no doc-cap check (retired).
- Invitations badge + banner: `fetchPendingPageInvitations`.

### 5.4 Editor (`app/page/[id]/page.tsx` + redirect, `components/editor-workspace.tsx`)

- New route `app/page/[id]/page.tsx` holds ALL logic (session/anon gate identical to `/doc/[id]` but via `fetchPageDetails`/`select_pages_public`); `app/doc/[id]/page.tsx` becomes a thin server component calling `redirect('/page/' + id)` from `next/navigation` — the anon public-viewer path lives entirely in the new route, so any visitor (signed in, signed out, public-page anon) is redirected first.
- Workspace loads `fetchPageDetails`, `fetchPageMemberRole` (owner → editor-capable; viewer → read-only toolbar, editable=false), `updatePageTitle` on title save, `fetchMentionablePageCollaborators` for @mentions.
- Share button opens the pages-based ShareModal. Viewer/anon gating unchanged in behavior.

### 5.5 Share modal + invitations + invite page

- `share-modal.tsx`: public-link toggle via `updatePagePublicStatus`; invite form via `createPageInvitation`; **new member list section** (avatar, name, remove button) via `fetchPageMembers`/`removePageMember` — this is the `page_members` UI. The role dropdown (`updatePageMemberRole`) appears only when the **page owner** opens the modal (the owner-only update policy is the RLS source of truth; the UI just hides the control from non-owners).
- `invitations.tsx`: pending page invites (notification dropdown + dashboard banner).
- `app/invite/[token]/page.tsx`: page-invite variant (`fetchPageInvitationDetails` → accept/decline via page functions; cookie flow unchanged).

### 5.6 Settings (`app/settings/page.tsx`, `components/settings-client.tsx`)

- Collaborators & Access tab: owned pages via `fetchOwnedPagesWithMembers`; remove member and change role via page functions. (Legacy "users tab" list of docs is replaced by pages.)

### 5.7 Version history (`components/version-history.tsx`, `app/api/version/route.ts`)

- Component: list via `document_versions` select (pages-aware RLS grants it), storage download works via the restored pages branch of `can_access_document_storage`.
- API route: owner/editor checks resolve pages first (owner or `page_members` role `editor`), documents fallback for unmapped ids; insert `document_versions` rows with `page_id` for pages.

## 6. Error Handling

- All service functions throw on Supabase errors (existing style); components keep their current toast/console patterns.
- `ensureWorkspace` race: `insert_workspaces` allows owner self-insert; a unique-violation on concurrent create is swallowed and the existing workspace fetched (idempotent).
- Invitee self-insert: if `acceptPageInvitation` hits a policy denial (e.g., invitation already consumed), surface the existing "invitation no longer valid" handling.
- Anon public viewer: unchanged mock-user path (`anon-<random>`, token `'anonymous'`).

## 7. Verification

Per-task gates (the P1 lesson applies: vitest+eslint never type-check — **`next build` is a gate on every task that touches TS**):

- `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"` (npm not on PATH)
- Focused vitest files only — the full suite OOMs/hangs on this machine
- `npm run lint`
- `npm run build` (next build)
- Migrations applied to the live project (`hftipkzqbltdkrcjynad`) via Supabase MCP `apply_migration`, then live RLS verification (membership matrix, invitee self-insert, twin-less page storage access, public page anon/stranger reads, pending-invite conversion)
- `node --check` on modified server files

## 8. Branching & Delivery

- Branch `p2-client-cutover` from `main` (created; `main` currently at `d8679ea`).
- Land via the repo's GitHub squash-merge PR pattern ("…(#N)"); `editor-enhancements` branch (fully merged) can be deleted locally.
- SDD workspace: `.superpowers/sdd/2026-08-15-p2-client-cutover/` (ledger + task briefs/reports, git-ignored).
