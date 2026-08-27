# AGENTS.md

## Agent skills & Domain Model

### Issue tracker & Project Board
- Issues, specs, and roadmap tickets live as GitHub issues via `gh` CLI (`/opt/homebrew/bin/gh`). See `docs/agents/issue-tracker.md`.
- Project board status: `Backlog → Ready → In progress → In review → Done`. Move items with `docs/agents/project-board.sh <issue> <status>`.

### Triage labels
Canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context — `CONTEXT.md` at repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.

### Virtual Startup Organization (Role Roster & Handoffs)
Enterprise multi-agent protocol: `po_pm`, `tech_lead`, `qa_engineer`, `dev_engineer`, `devops_engineer`, `marketing_growth`. See `docs/agents/organization.md`.

---

## 6-Stage Engineering Lifecycle (Mandatory Anti-Drift Engine)

Every ticket, feature, bug, or refactor moves strictly through these 6 stages:

```text
  DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
 ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
 │ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
 │Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
 └──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  /spec          /plan          /build        /test         /review       /ship
```

### 1. DEFINE (`/spec`)
- **Action**: Restate ticket acceptance criteria, interrogate edge cases against `CONTEXT.md` and ADRs.
- **Skills**: `interview-me`, `grill-with-docs`, `spec-driven-development`.
- **Artifact**: `docs/superpowers/specs/<issue>-spec.md`.

### 2. PLAN (`/plan`)
- **Action**: Architectural decomposition into atomic tasks, defining test requirements for each.
- **Skills**: `planning-and-task-breakdown`, `writing-plans`.
- **Artifact**: `implementation_plan.md`.

### 3. BUILD (`/build`)
- **Action**: Atomic TDD slices (Red-Green-Refactor). UI code follows `vercel-react-best-practices` and #79 UX-parity.
- **Skills**: `test-driven-development`, `subagent-driven-development`, `using-git-worktrees`, `vercel-react-best-practices`.
- **Artifact**: Working code + unit tests.

### 4. VERIFY (`/test`)
- **Action**: Full verification suite execution proving zero regressions.
- **Command**: `npm run typecheck && npm run lint && npm test && npm run build`.
- **Mindset**: `verification-before-completion` (No "done" claims without passing terminal outputs).

### 5. REVIEW (`/review`)
- **Action**: Mandatory clean-room adversarial subagent review gate.
- **Subagent**: `invoke_subagent(Model: 'pro', Role: 'Clean-Room Reviewer')` evaluating `git diff origin/main...HEAD`.
- **Audits 4 Axes**:
  1. Spec & Acceptance Criteria (`CONTEXT.md`, ADR invariants, `lib/tier-limits.ts`).
  2. Frontend & Accessibility (`<button>` vs `<div>`, ARIA roles, `useEffect` cleanups).
  3. CRDT & Storage (IndexedDB transaction atomicity, binary delta compression).
  4. Backend Security & Errors (Query error propagation, storage rollback integrity).
- **Artifact**: `docs/reviews/pr-<id>-review.md`. Fix all valid findings before proceeding.

### 6. SHIP (`/ship`)
- **Action**: Create PR, merge, clean up blocker trees, update roadmap and project board.
- **Hygiene**:
  - Remove outgoing blocker edges from children (`DELETE /issues/<child>/dependencies/blocked_by/<db-id>`).
  - Move project board status: `docs/agents/project-board.sh <issue> Done`.
  - Update `docs/roadmap.md` and commit doc updates.

---

## Parallel Subagent & Git Worktree Execution Protocol

To maximize velocity without degrading code quality or creating file conflicts:
1. **Interface Contract First**: Before parallel dispatch, the Lead Agent defines the shared TypeScript interfaces and API schemas (`types.ts`).
2. **Parallel Worktree Dispatch**: Dispatch independent tasks concurrently via `invoke_subagent` using `Workspace: 'branch'` or `Workspace: 'share'` (linked Git worktrees).
3. **Isolated TDD**: Each subagent implements Red-Green-Refactor within its isolated workspace, ensuring its specific test suite passes before reporting back.
4. **Integration & Rebase**: The Lead Agent merges/rebases subagent branches into the epic branch.
5. **Full Suite Verification**: The Lead Agent runs `npm run typecheck && npm run lint && npm test && npm run build` across the entire codebase.
6. **Clean-Room Review Gate**: Mandatory adversarial review subagent (`invoke_subagent(Model: 'pro', Role: 'Clean-Room Reviewer')`) audits `git diff origin/main...HEAD` before PR creation.

---

## Multi-Session Resumption Protocol (Zero Context Drift)

When starting a new session or after context compaction, execute this protocol immediately:

1. **Inspect Git Context**: `git status && git log -n 3 --oneline`
2. **Identify Active Ticket & Branch**: Look at active branch `feat/<issue>-<slug>`.
3. **Determine Stage**:
   - Spec missing $\rightarrow$ Stage 1 (DEFINE)
   - Plan missing $\rightarrow$ Stage 2 (PLAN)
   - Tests failing / incomplete $\rightarrow$ Stage 3 (BUILD)
   - Verification unverified $\rightarrow$ Stage 4 (VERIFY)
   - Unreviewed $\rightarrow$ Stage 5 (REVIEW)
   - Ready to merge $\rightarrow$ Stage 6 (SHIP)
4. **Resume Execution Immediately**: Never guess or ask "what were we doing?".

