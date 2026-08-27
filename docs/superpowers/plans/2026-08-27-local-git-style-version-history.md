# Local-First Git-Style Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a local-first, Git-style version history engine with multi-platform storage adapters (IndexedDB/Desktop FS), non-destructive forward restore, an interactive visual diff timeline drawer, and Issue #82 cloud tier retention plumbing.

**Architecture:** A pluggable `VersionHistoryStorageAdapter` interface powering local delta compression in IndexedDB/FS, integrated with a React slide-out timeline drawer featuring word-level diffing and Git-style non-destructive restores. Cloud retention is gated per workspace plan.

**Tech Stack:** TypeScript, React 19, Tiptap 3 / Yjs CRDTs, IndexedDB (`idb`), `fflate` / browser compression, Tailwind CSS, Shadcn UI / Radix UI, Vitest.

## Global Constraints

- Use tabs for indentation, single quotes for strings, omit semicolons.
- Functional React components with strict TypeScript interfaces.
- TDD required: write failing tests before implementation code for every task.
- Non-destructive restore invariant: restoring past state MUST create a new forward commit and never delete prior history.
- Local history is 100% free and unlimited on user device; cloud retention is tier-gated (Free=1d, Plus=90d, Pro=1yr).

---

### Task 1: Core Version History Types, Compression & Storage Adapters

**Files:**
- Create: `lib/version-history/types.ts`
- Create: `lib/version-history/compression.ts`
- Create: `lib/version-history/adapters/memory.ts`
- Create: `lib/version-history/adapters/indexeddb.ts`
- Test: `tests/unit/version-history-storage.test.ts`

**Interfaces:**
- Produces: `DocumentCheckpoint`, `VersionHistoryStorageAdapter`, `MemoryHistoryAdapter`, `IndexedDBHistoryAdapter`, `compressSnapshot`, `decompressSnapshot`.

- [ ] **Step 1: Write the failing tests for compression and storage adapters**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement types, compression, and adapters**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Version History Controller & Non-Destructive Restore Engine

**Files:**
- Create: `lib/version-history/engine.ts`
- Test: `tests/unit/version-history-engine.test.ts`

**Interfaces:**
- Consumes: `VersionHistoryStorageAdapter`, `compressSnapshot`, `decompressSnapshot`.
- Produces: `VersionHistoryEngine` (`createMilestone`, `createAutoCheckpoint`, `restoreCheckpoint`, `listVersions`).

- [ ] **Step 1: Write the failing tests for VersionHistoryEngine**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement VersionHistoryEngine**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 3: Modern Version History Slide-Out Drawer & Visual Diff UI

**Files:**
- Create: `components/version-history/version-drawer.tsx`
- Create: `components/version-history/visual-diff-viewer.tsx`
- Create: `components/version-history/restore-confirm-dialog.tsx`
- Test: `tests/unit/version-history-ui.test.tsx`

**Interfaces:**
- Consumes: `VersionHistoryEngine`, `DocumentCheckpoint`.
- Produces: `VersionDrawer` component with interactive timeline, time-travel diffing, and milestone creation.

- [ ] **Step 1: Write the failing UI tests**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement VisualDiffViewer and VersionDrawer**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 4: Editor Workspace Integration & Hotkey (`Cmd+Shift+S`)

**Files:**
- Modify: `components/editor-workspace.tsx`
- Modify: `components/version-history.tsx`
- Test: `tests/unit/version-history-editor-integration.test.tsx`

- [ ] **Step 1: Write integration tests for editor workspace hotkey and auto-checkpointing**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Mount VersionDrawer in `components/editor-workspace.tsx`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 5: Backend Tier Enforcement & Distinct Collaborator Ledger (Issue #82 Scope)

**Files:**
- Create: `lib/tier-limits.ts`
- Create: `server/retention.js`
- Modify: `server/index.js`
- Test: `tests/unit/tier-limits-retention.test.ts`

- [ ] **Step 1: Write tests for plan limits and retention cleanup**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `lib/tier-limits.ts` and `server/retention.js`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 6: Full Verification Suite & Issue Updates

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Run full verification suite (`npm run typecheck && npm run lint && npm test && npm run build`)**
- [ ] **Step 2: Update roadmap and commit**
