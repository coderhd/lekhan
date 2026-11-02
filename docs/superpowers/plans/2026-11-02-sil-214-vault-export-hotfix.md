# SIL-214 Vault Export Hotfix — Implementation Plan

**Goal:** make cold collab rooms hydrate before sync and make export reads
non-destructive, then surface unverified empty bodies honestly.

**Spec:** [`docs/superpowers/specs/SIL-214-vault-export-cold-export-spec.md`](../specs/SIL-214-vault-export-cold-export-spec.md)

## Tasks (TDD order)

1. **Server hydration gate** — add `server/collab-persistence.js` with
   `createCollabPersistence` + `openHydratedDoc`; wire it into `server/index.js`;
   await hydration before `setupWSConnection`; skip `writeState` for
   un-hydrated/failed/read-only-only rooms. Tests:
   `tests/unit/sync-collab-persistence.test.ts`.
2. **Read-only connection mode** — `readOnly=1` upgrade param, reject update
   frames, do not mark the room writable. Export source sends it.
3. **Load shedding (F3)** — measure `heapUsed / heap_size_limit` (V8), expose
   both used and limit in `/health`. Test:
   `tests/unit/sync-server-health-metrics.test.ts`.
4. **Client read status** — `createClientPageDocSource` returns
   `{ doc, status: 'ok' | 'empty' | 'unavailable' }`; loader emits a
   `content-unverified` warning only when `page.hasStoredContent`. Tests:
   `vault-export-source.test.ts`, `vault-export-loader.test.ts`.
5. **Honest report UI** — merge load warnings into the report and replace
   "Export complete" with a warning header when warnings exist. Test:
   `event-instrumentation.test.tsx` / new card test.
6. **Cold-room integration test** — populated stored snapshot, cold server, no
   writable connections → source returns the body, stored bytes unchanged; a
   writable room still persists. Test: `vault-export-cold-room.test.ts`.
7. **Docs** — amend ADR 0006 with the hydration/read-only contract; roadmap
   entry.
8. **Verify** — `npm run typecheck && npm run lint && npm test && npm run build`.
9. **Review / ship** — clean-room adversarial review, PR, external review gate.

## Constraints

- No new export endpoint; export stays fully client-side.
- Server tests must not require a live Supabase instance (inject storage
  readers/persisters).
- Keep the existing 2 s idle / 10 s max-throttle persistence contract.
