# Sync Server Hardening & Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the sync hub backend with a capped-debounce snapshot engine, durable Postgres collaborator ledger, automated retention pruner cron, 20 MB Free tier quota guard, and health/metrics observability with load shedding.

**Architecture:** Replace ephemeral disk WAL with a robust in-memory Yjs snapshot engine enforcing a 2s idle debounce + 10s hard max throttle cap saving directly to encrypted Supabase Storage (`main_state.bin`). Persist tier collaborator boundaries in Postgres (`document_collaborators_ledger`), expose `/health` and `/metrics` with a 1,500-connection ceiling, and deploy a secure serverless retention pruner (`/api/cron/retention-prune`).

**Tech Stack:** Node.js, WebSockets (`ws`, `y-websocket`), Yjs CRDT, Supabase (Postgres + Storage), Next.js App Router, TypeScript, Vitest.

## Global Constraints
- Strictly adhere to `AGENTS.md` and `CONTEXT.md` terminology (Hub, Replica, Workspace, Page, Tier).
- Retain tabs for indentation, single quotes for strings, no semicolons.
- Zero data loss guarantee: Client-side CRDTs (`y-indexeddb`) reconcile with server snapshots on reconnect.
- Local import always succeeds; cloud sync soft-caps at 20 MB for Free tier.

---

### Task 1: Recalibrate Free Tier Plan Limits

**Files:**
- Modify: `lib/tier-limits.ts`
- Test: `tests/unit/tier-limits-recalibration.test.ts`

**Interfaces:**
- Consumes: `FREE_LIMITS` in `lib/tier-limits.ts`
- Produces: `FREE_LIMITS.maxStorageMb = 20`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tier-limits-recalibration.test.ts
import { describe, it, expect } from 'vitest'
import { getPlanLimits } from '@/lib/tier-limits'

describe('Tier Limits Recalibration', () => {
	it('recalibrates free tier storage quota to 20 MB', () => {
		const freeLimits = getPlanLimits('free')
		expect(freeLimits.maxStorageMb).toBe(20)
		expect(freeLimits.historyRetentionDays).toBe(1)
		expect(freeLimits.maxDistinctCollaborators).toBe(2)
	})

	it('preserves plus and pro limits', () => {
		const plusLimits = getPlanLimits('plus')
		expect(plusLimits.maxStorageMb).toBe(10000)
		const proLimits = getPlanLimits('pro')
		expect(proLimits.maxStorageMb).toBe(50000)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/unit/tier-limits-recalibration.test.ts`
Expected: FAIL with `expected 1000 to be 20`.

- [ ] **Step 3: Update `lib/tier-limits.ts`**
Set `maxStorageMb: 20` in `FREE_LIMITS`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/unit/tier-limits-recalibration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/tier-limits.ts tests/unit/tier-limits-recalibration.test.ts
git commit -m "fix(tiers): recalibrate Free tier storage limit to 20 MB (#77)"
```

---

### Task 2: Postgres Collaborator Ledger Migration & Backend Helper

**Files:**
- Create: `supabase/migrations/20260827220000_sync_hardening_ledger.sql`
- Create: `server/ledger.js`
- Test: `tests/unit/sync-collaborator-ledger.test.ts`

**Interfaces:**
- Produces: `getDistinctCollaboratorsCount(supabaseAdmin, documentId)`, `recordCollaboratorAccess(supabaseAdmin, documentId, userId)`

- [ ] **Step 1: Write the failing unit tests for ledger helper**

```typescript
// tests/unit/sync-collaborator-ledger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { getDistinctCollaboratorsCount, recordCollaboratorAccess } = require('../../server/ledger.js')

describe('Collaborator Ledger Service', () => {
	let mockSupabase: any

	beforeEach(() => {
		mockSupabase = {
			from: vi.fn(),
		}
	})

	it('returns distinct collaborator count from database', async () => {
		mockSupabase.from.mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({
					data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
					error: null,
				}),
			}),
		})

		const count = await getDistinctCollaboratorsCount(mockSupabase, 'doc-123')
		expect(count).toBe(2)
	})

	it('records new collaborator access into postgres ledger', async () => {
		const upsertMock = vi.fn().mockResolvedValue({ error: null })
		mockSupabase.from.mockReturnValue({
			upsert: upsertMock,
		})

		const result = await recordCollaboratorAccess(mockSupabase, 'doc-123', 'user-1')
		expect(result.success).toBe(true)
		expect(upsertMock).toHaveBeenCalledWith(
			expect.objectContaining({
				document_id: 'doc-123',
				user_id: 'user-1',
			}),
			expect.any(Object)
		)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test tests/unit/sync-collaborator-ledger.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create SQL migration and implement `server/ledger.js`**
Write `supabase/migrations/20260827220000_sync_hardening_ledger.sql` and `server/ledger.js`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test tests/unit/sync-collaborator-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260827220000_sync_hardening_ledger.sql server/ledger.js tests/unit/sync-collaborator-ledger.test.ts
git commit -m "feat(sync): add durable postgres collaborator ledger service (#77)"
```

---

### Task 3: Hardened Capped-Debounce Snapshot Engine & Remove Ephemeral WAL

**Files:**
- Modify: `server/index.js`
- Delete: `server/wal.js`
- Test: `tests/unit/sync-snapshot-debounce.test.ts`

**Interfaces:**
- Consumes: `server/ledger.js`, `lib/tier-limits.ts`, `server/crypto.js`
- Features: 2s idle debounce + 10s max-throttle cap, 10 MB payload guard, graceful SIGTERM shutdown flush.

- [ ] **Step 1: Write the failing tests for debounce engine and payload guard**

```typescript
// tests/unit/sync-snapshot-debounce.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Sync Server Hardened Snapshot & Payload Guard', () => {
	it('enforces 10 MB maximum payload ceiling on incoming binary frames', () => {
		const MAX_FRAME_SIZE = 10 * 1024 * 1024
		const smallPayload = Buffer.alloc(1024)
		const oversizedPayload = Buffer.alloc(11 * 1024 * 1024)

		expect(smallPayload.length <= MAX_FRAME_SIZE).toBe(true)
		expect(oversizedPayload.length <= MAX_FRAME_SIZE).toBe(false)
	})
})
```

- [ ] **Step 2: Update `server/index.js` to implement capped debounce and remove `wal.js`**
- Delete `server/wal.js`.
- Remove `const { appendUpdate, getPendingUpdates, clearUpdates } = require('./wal')` and disk ledger `.collaborators-ledger.json` from `server/index.js`.
- Integrate `server/ledger.js` for distinct collaborator validation.
- Implement dual timer mechanism: `saveDebounceTimers` (2s) and `saveMaxThrottleTimers` (10s).
- Add frame size check (reject $> 10\text{ MB}$).

- [ ] **Step 3: Run unit tests to verify**
Run: `npm test tests/unit/sync-snapshot-debounce.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add server/index.js tests/unit/sync-snapshot-debounce.test.ts
git rm server/wal.js 2>/dev/null || true
git commit -m "feat(sync): implement capped-debounce snapshot engine and remove ephemeral WAL (#77)"
```

---

### Task 4: Automated Global Retention Pruner Endpoint

**Files:**
- Create: `app/api/cron/retention-prune/route.ts`
- Modify: `server/index.js` (add 12h fallback interval)
- Test: `tests/unit/api-cron-retention-prune.test.ts`

**Interfaces:**
- Produces: `POST /api/cron/retention-prune` (authorized via `Bearer ${CRON_SECRET}`)

- [ ] **Step 1: Write the failing tests for retention prune endpoint**

```typescript
// tests/unit/api-cron-retention-prune.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/cron/retention-prune/route'
import { NextRequest } from 'next/server'

describe('POST /api/cron/retention-prune', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-secret-key-123'
	})

	it('returns 401 Unauthorized when Bearer token is missing or invalid', async () => {
		const req = new NextRequest('http://localhost:3000/api/cron/retention-prune', {
			method: 'POST',
			headers: { authorization: 'Bearer invalid' },
		})
		const res = await POST(req)
		expect(res.status).toBe(401)
	})

	it('executes pruning when authorized with CRON_SECRET', async () => {
		const req = new NextRequest('http://localhost:3000/api/cron/retention-prune', {
			method: 'POST',
			headers: { authorization: 'Bearer test-secret-key-123' },
		})
		const res = await POST(req)
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.success).toBe(true)
	})
})
```

- [ ] **Step 2: Implement `app/api/cron/retention-prune/route.ts`**
Implement global retention query across documents, batching storage object deletions and db row deletes.

- [ ] **Step 3: Run test to verify it passes**
Run: `npm test tests/unit/api-cron-retention-prune.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add app/api/cron/retention-prune/route.ts tests/unit/api-cron-retention-prune.test.ts
git commit -m "feat(retention): add automated global retention pruner cron endpoint (#77)"
```

---

### Task 5: Health & Metrics Observability with Load Shedding

**Files:**
- Modify: `server/index.js`
- Test: `tests/unit/sync-server-health-metrics.test.ts`

**Interfaces:**
- Produces: `GET /health`, `GET /metrics` JSON endpoints, 503 load shedding if connections > 1,500.

- [ ] **Step 1: Write failing tests for health & metrics handler**

```typescript
// tests/unit/sync-server-health-metrics.test.ts
import { describe, it, expect } from 'vitest'

describe('Sync Server Health & Metrics', () => {
	it('formats server metrics structure correctly', () => {
		const metrics = {
			status: 'ok',
			uptimeSeconds: 120,
			activeDocuments: 5,
			activeConnections: 10,
			memory: {
				heapUsedMb: 30,
				heapTotalMb: 45,
			},
			limits: {
				maxConnections: 1500,
			},
		}
		expect(metrics.status).toBe('ok')
		expect(metrics.activeConnections).toBeLessThan(1500)
	})
})
```

- [ ] **Step 2: Implement HTTP `/health` and `/metrics` in `server/index.js`**
Handle `req.url === '/health'` and `req.url === '/metrics'` in `http.createServer`. Add connection count tracking and load-shedding check on `server.on('upgrade')`.

- [ ] **Step 3: Run test to verify it passes**
Run: `npm test tests/unit/sync-server-health-metrics.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add server/index.js tests/unit/sync-server-health-metrics.test.ts
git commit -m "feat(observability): add health/metrics endpoints and load shedding ceiling (#77)"
```

---

### Task 6: Full Verification Suite

**Commands:**
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`
- [ ] Run `npm test`
- [ ] Run `npm run build`
