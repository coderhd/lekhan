# SIL-229 — Sync indicator truthfulness: cold-start copy + local-edits-only state

**Parent:** SIL-8 / #79 UX-parity quality bar · epic #141 GAP-6 (P2)
**Issue:** [#141](https://github.com/coderhd/Lekhan/issues/141) — "sync status indicator always truthful; never a spinner where state is known"

## Problem

`components/sync-indicator.tsx` collapses three materially different situations into
two misleading chips:

1. `connecting` renders a spinner labelled **"Connecting..."**. That window deliberately
   covers the ~50 s Render free-tier cold start (`RECONNECT_GRACE_PERIOD_MS = 60_000`).
   A known, explainable state is presented as an open-ended spinner.
2. When the browser is offline (or the hub is unreachable) **and** the user has typed,
   the chip only says **"Offline"**. It hides the fact that those edits are durable on
   this device and are waiting to reach the hub — the single most reassuring fact in
   that moment.

CONTEXT.md vocabulary applies: **Hub** (server-side sync layer), **Replica** (device's
local copy). Avoid "server"/"cloud" in user-facing copy.

## Required behavior (state precedence)

The indicator derives one state from `connectionState`, `isSynced`, and
`hasUnsyncedChanges` (already returned by `useEditorCollab`):

| Condition | State | Copy |
| --- | --- | --- |
| `connectionState === 'connected' && isSynced` | `synced` | **Synced** |
| `connectionState === 'connected' && !isSynced` | `saving` | **Saving...** (transient convert — unchanged) |
| `connectionState === 'connecting' && hasUnsyncedChanges` | `local-edits-only` | **Local edits only** |
| `connectionState === 'connecting'` | `connecting` | **Connecting to hub...** |
| `connectionState === 'offline' && hasUnsyncedChanges` | `local-edits-only` | **Local edits only** |
| `connectionState === 'offline'` | `offline` | **Offline** |

Rationale for precedence: when connected, an in-flight convert is the most accurate
description (`hasUnsyncedChanges` is also true during that window, but "Local edits only"
would imply nothing is happening). When not connected and edits exist, "Local edits
only" outranks "Offline"/"Connecting" because it answers the user's real question.

### Copy and accessibility

- **Connecting** carries a `title` explaining the known cold start: the hub can take up
  to a minute to wake from idle, and edits stay on this device meanwhile. The spinner is
  now backed by a specific, known state rather than masking it.
- **Local edits only** carries a `title` stating the edits are kept on this device and
  will sync when the hub reconnects.
- The chip exposes `role="status"` + `aria-live="polite"` and a visually hidden explanation,
  so the meaning is announced rather than conveyed only by color or a hover `title`.
- Light-mode text tokens are darkened one step (`amber-800`, `emerald-700`, `red-700`) so
  the 12 px semibold labels clear WCAG AA (4.5:1) on the cream surfaces; dark tokens are
  unchanged.

### Prop plumbing

`SyncIndicator` gains optional `hasUnsyncedChanges?: boolean` (default `false`) and
`isLocalSynced?: boolean` (default `true`). `editor-workspace.tsx` passes the hook's
`hasUnsyncedChanges` and `isLocalSynced`; `MobileHeaderMenu` accepts and forwards both so
desktop and mobile agree.

### Trustworthy `hasUnsyncedChanges` (review MAJOR-1)

The component is only as truthful as its input. `isDirty` previously stayed `true` for the
whole connection after the first local edit (it was cleared only on a websocket `sync`
event), so an ordinary Wi-Fi flap claimed "Local edits only" for edits already delivered;
and a reload while offline lost the flag entirely.

`hooks/use-editor-collab.ts` now:
- clears `isDirty` when a local update is flushed over an open, synced socket
  (`wsProvider.wsconnected && wsProvider.synced`, where y-websocket sends synchronously);
- persists a per-document pending marker in `lib/local-edits-marker.ts`, so genuine
  IndexedDB-pending edits survive a reload and are still reported as "Local edits only";
- clears the marker on hub sync and resets `isDirty` on unmount/document switch.

### Durability claim (review MINOR-3)

`isLocalSynced` gates the wording: only after y-indexeddb has opened does the chip say edits
are "saved on this device"; before that it says they are "still in this tab".

## Non-goals

- No change to the 60 s reconnect grace-period logic or the connection-state machine
  (the local-dirty tracking inside the hook is fixed so the indicator's input is truthful).
- No new persistence behavior; durability already comes from y-indexeddb.
- No design-system/color overhaul — reuse existing chip styling.
- No duration countdown (we do not know the true remaining cold-start time).

## Acceptance criteria

1. Offline **with** pending local edits shows **Local edits only**, not **Offline** —
   including after a reload while offline (persisted pending marker).
2. Connecting **with** pending local edits shows **Local edits only**.
3. Connecting **without** pending edits shows **Connecting to hub...** (no longer the
   unqualified "Connecting...").
4. Connected-but-not-yet-synced still shows **Saving...**; an edit already flushed to the
   hub does not later masquerade as "Local edits only" on a brief disconnect.
5. Synced shows **Synced**; offline with no pending edits shows **Offline**.
6. Both call sites (desktop header + mobile menu) pass `hasUnsyncedChanges` and
   `isLocalSynced`.
7. `role="status"` plus a screen-reader-available explanation; cold start and durability
   conveyed in text, not color/`title` alone.
8. Light-mode chip text meets WCAG AA (4.5:1).
9. Unit tests cover the full precedence table, the no-spinner invariant, the mobile
   forwarding, and the pending-edit marker; typecheck, lint, unit suite, and build pass.
