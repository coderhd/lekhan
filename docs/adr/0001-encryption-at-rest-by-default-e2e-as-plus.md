# 0001 — Encryption at rest by default; end-to-end encryption as an opt-in Plus feature

Date: 2026-08-23
Status: Accepted

## Context

Page content is stored as Yjs binary snapshots in Supabase Storage (`documents/<id>/main_state.bin`,
uploaded by `server/index.js`). Today it is readable by the server and by anyone with the service-role
key. For a product whose wedge includes privacy-sensitive Obsidian users, "your second brain sits
unencrypted on our cloud" contradicts the brand.

True client-side E2E encryption conflicts with two shipped H0 features that consume plaintext
server-side (`server/index.js:65` → `graphIndex.indexPage`):

- Global search (`pages.searchable_text`, epic #25)
- Server-side graph index extraction (`page_links`, `page_tags`)

## Decision

Two distinct levels, explicitly separated:

1. **Default (all tiers): encrypted at rest + TLS in transit**, server-held keys. Protects against
   storage-level breaches and infrastructure compromise. Keeps server-side search and graph indexing
   fully functional.
2. **E2E (opt-in per workspace, Plus feature):** keys generated and held client-side
   (AES-256-GCM pattern already in `lib/crypto.ts`). With documented tradeoffs while the gap exists:
   no server-side global search or server-extracted links/tags for E2E workspaces until
   client-side indexing ships. Local search over the on-device replica still works.

## Consequences

- Marketing must not claim "end-to-end encrypted by default." The default claim is "encrypted at rest."
- E2E workspaces need a feature-parity matrix published honestly at toggle time.
- When client-side link/tag/search indexing lands (candidate for H1), the E2E tradeoff list shrinks;
  revisit this ADR then.
