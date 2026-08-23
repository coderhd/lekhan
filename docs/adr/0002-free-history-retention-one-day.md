# 0002 — Version history retention: 1 day on Free, longer on paid tiers

Date: 2026-08-23
Status: Accepted
Amends: strategy spec §7.2 (Free tier previously stated "7-day history")

## Context

Version snapshots are full Yjs state binaries uploaded to the same Supabase Storage bucket as live
document state (`app/api/version/route.ts:193`, `components/version-history.tsx:83`). The free-tier
infrastructure budget is 1 GB of Storage total, shared across all users. History retention multiplies
storage per user roughly by (retention days × snapshot frequency), so history length is one of the
few levers that directly controls free-tier runway.

## Decision

- **Free:** 1-day version history.
- **Plus/Pro/Team:** 90 days / 1 year / per plan matrix (strategy §7.2 for paid tiers unchanged).

## Consequences

- Free-tier Storage pressure drops materially versus 7-day retention.
- The retention boundary is an upgrade surface: users hitting the 1-day limit are invested users —
  surface the paywall prompt at that moment.
- Retention enforcement needs a cleanup job deleting expired version objects; not yet built.
