# Spec #77: Sync Server Hardening & Durability Architecture

- **Status**: SPEC APPROVED (Ready for `/plan`)
- **Epic**: #77 (H0 — Sync Server Hardening)
- **Author**: Antigravity Pair Programming Engine
- **Target Launch**: H0 Foundation & Pre-Beta Gate
- **Related ADRs**: [ADR 0001](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0001-encryption-at-rest-by-default-e2e-as-plus.md), [ADR 0002](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0002-free-history-retention-one-day.md), [ADR 0004](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0004-server-hub-crdt-sync-topology.md)

---

## 1. Executive Summary & Problem Statement

The sync hub (`server/index.js`) is the load-bearing backend infrastructure for real-time collaboration, multi-device replication, and cross-platform CRDT merge semantics.

### 1.1 Identified Weaknesses in Current Implementation
1. **Uncapped Debounce Save Vulnerability**: The existing save debounce in `server/index.js` resets on every keystroke without an enforced maximum throttle. Continuous typing could delay cloud saves indefinitely.
2. **Ephemeral Disk I/O**: `server/wal.js` writes binary updates to local ephemeral disk (`wal_logs/`), which is wiped on container restarts (e.g. Render spin-downs) while adding unnecessary file I/O complexity.
3. **Volatile Collaborator Ledger**: `.collaborators-ledger.json` is stored on local disk, resetting distinct collaborator tier limits on every deploy or server restart.
4. **Unbounded Version Growth for Dormant Documents**: Version retention pruning ([ADR 0002](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0002-free-history-retention-one-day.md)) only ran when an active document was saved; dormant/untouched documents never pruned expired versions.
5. **Storage Quota Drift**: `lib/tier-limits.ts` set Free tier storage to 1000 MB (1 GB), which matched our *entire* backend free infrastructure budget rather than a safe per-workspace quota.

---

## 2. Hardened Architecture & Key Decisions

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HARDENED SYNC SERVER ARCHITECTURE                        │
│                                                                             │
│  ┌───────────────────────┐             ┌─────────────────────────────────┐  │
│  │   Connected Clients   │             │       Node.js Sync Server       │  │
│  │ (Web / Desktop / PWA) │             │       (server/index.js)         │  │
│  └──────────┬────────────┘             └────────────────┬────────────────┘  │
│             │                                           │                   │
│             │ WebSocket Connection                      │                   │
│             │ (Encrypted Binary Frames, max 10MB)       │                   │
│             ▼                                           │                   │
│  ┌───────────────────────┐                              │                   │
│  │   Auth & Tier Gate    │                              │                   │
│  │ (server/auth.js)      ├──────────────────────────────┤                   │
│  └──────────┬────────────┘                              │                   │
│             │                                           │                   │
│             ▼                                           │                   │
│  ┌────────────────────────────────────────┐             │                   │
│  │ Postgres: document_collaborators_ledger│             │                   │
│  │ (Durable per-workspace distinct caps)  │             │                   │
│  └────────────────────────────────────────┘             │                   │
│                                                         │                   │
│  ┌──────────────────────────────────────────────────────┴────────────────┐  │
│  │ Hardened Snapshot Engine:                                             │  │
│  │ • In-memory Y.Doc merge                                               │  │
│  │ • 2-second idle debounce + 10-second hard maximum throttle cap        │  │
│  │ • Encrypted AES-256-GCM write to Supabase Storage (main_state.bin)     │  │
│  │ • Graceful SIGTERM/SIGINT shutdown flush                              │  │
│  │ • Deprecate ephemeral server/wal.js                                   │  │
│  └──────────────────────────────────────┬────────────────────────────────┘  │
│                                         │                                   │
│                                         ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Supabase Cloud Storage (documents/<id>/main_state.bin)                │  │
│  │ • 20 MB Free Storage Quota (lib/tier-limits.ts)                       │  │
│  │ • Non-blocking import & soft-capped cloud sync status                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Specifications

### 3.1 Hardened Snapshot Engine (`server/index.js`)
- **Idle Debounce**: When an update arrives, schedule save in 2,000 ms.
- **Max Throttle Cap**: If continuous updates arrive, force a save after at most 10,000 ms from the first un-flushed update.
- **Save Sequence**:
  1. Encode Yjs state via `Y.encodeStateAsUpdate(ydoc)`.
  2. Encrypt binary state with AES-256-GCM ([ADR 0001](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0001-encryption-at-rest-by-default-e2e-as-plus.md)).
  3. Upload encrypted snapshot to `documents/${documentId}/main_state.bin`.
  4. Extract text and update `graphIndex.indexPage` for `pages` (or update `documents` table).
- **Graceful Shutdown**:
  - Intercept `SIGTERM` and `SIGINT`.
  - Flush all dirty in-memory Ydocs to Supabase Storage concurrently using `Promise.allSettled`.
  - Clear timers and exit process cleanly with code 0.
- **Retirement of `server/wal.js`**:
  - Remove ephemeral filesystem writes and `wal_logs/` directory.

### 3.2 Durable Collaborator Ledger
- **Database Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS public.document_collaborators_ledger (
    document_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (document_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_collab_ledger_doc_id 
    ON public.document_collaborators_ledger(document_id);

  ALTER TABLE public.document_collaborators_ledger ENABLE ROW LEVEL SECURITY;
  ```
- **Connection Handshake Logic**:
  - Query `document_collaborators_ledger` for distinct `user_id` count for `document_id`.
  - If user is new and count >= `limits.maxDistinctCollaborators`, reject handshake with `HTTP 4403 Forbidden` (`X-Reason: Upgrade Required`).
  - If allowed and new, upsert row into `document_collaborators_ledger`.

### 3.3 Storage Quota & Payload Safeguards
- **Per-Frame Payload Cap**: Reject WebSocket binary messages > 10 MB to prevent memory saturation and malformed buffer attacks.
- **Recalibrated Plan Limits (`lib/tier-limits.ts`)**:
  ```typescript
  const FREE_LIMITS: PlanLimits = {
    historyRetentionDays: 1,
    maxDistinctCollaborators: 2,
    maxStorageMb: 20 // 20 MB soft-cap for cloud sync
  }
  ```
- **Soft-Capped Sync Philosophy**:
  - Local import / local notes in IndexedDB are **never blocked or paywalled**.
  - Cloud sync to Supabase Storage gracefully pauses when total workspace storage exceeds 20 MB, displaying an informative, non-blocking UI badge in the sync indicator.

### 3.4 Automated Version Retention Pruner
- **Serverless Endpoint**: `app/api/cron/retention-prune/route.ts`
  - Secured via `Authorization: Bearer ${CRON_SECRET}`.
  - Queries all `document_versions` older than plan cutoff date ([ADR 0002](file:///Users/harshdave/Desktop/projects/Lekhan/docs/adr/0002-free-history-retention-one-day.md)).
  - Deletes expired binary files from Supabase Storage (`documents/<docId>/versions/<versionId>.bin`) and deletes database rows.
  - Returns execution summary: `{ success: true, prunedDocumentsCount, prunedVersionsCount, durationMs }`.
- **Sync Server Fallback Interval**:
  - Run background retention sweep every 12 hours in `server/index.js` to catch any missed crons.

### 3.5 Observability & Overload Protection
- **Health & Metrics Endpoint (`GET /health` / `GET /metrics`)**:
  - Returns JSON status:
    ```json
    {
      "status": "ok",
      "uptimeSeconds": 1420,
      "activeDocuments": 12,
      "activeConnections": 18,
      "memory": {
        "rssMb": 48.5,
        "heapUsedMb": 28.2,
        "heapTotalMb": 35.1
      },
      "limits": {
        "maxConnections": 1500,
        "heapUtilizationPct": 80.3
      }
    }
    ```
- **Load Shedding**:
  - If active WebSocket connections > 1500 or heap usage > 85%, new WebSocket upgrade requests receive `HTTP 503 Service Unavailable / Server Busy`.

---

## 4. Acceptance Criteria & Verification Plan

- [ ] **Max-Throttle Debounce**: Rapid continuous updates force save to Supabase Storage within 10 seconds.
- [ ] **Idle Debounce**: Updates flush 2 seconds after typing pauses.
- [ ] **Collaborator Ledger Persistence**: Distinct collaborator limits survive server restart and are verified via Postgres tests.
- [ ] **Payload Guard**: Binary WebSocket frames > 10 MB are cleanly rejected.
- [ ] **Retention Cron**: `POST /api/cron/retention-prune` correctly purges expired versions with valid `CRON_SECRET` and rejects unauthorized requests with 401.
- [ ] **Health Endpoint**: `GET /health` and `GET /metrics` return live server stats and load limits.
- [ ] **Verification**: `npm run typecheck && npm run lint && npm test && npm run build` pass cleanly.
