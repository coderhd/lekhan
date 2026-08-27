# Lekhan Engineering Lifecycle & Anti-Drift Workflow

This document defines the 6-stage engineering lifecycle and skill execution standards for Lekhan.

```text
  DEFINE          PLAN           BUILD          VERIFY         REVIEW          SHIP
 ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
 │ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
 │Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
 └──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
  /spec          /plan          /build        /test         /review       /ship
```

---

## 1. Stage 1: DEFINE (`/spec`)

### Objectives
- Socratic requirements interrogation before code is touched.
- Interrogate edge cases, threat models, and UI parity against `CONTEXT.md` and ADRs.

### Skills & Tools
- `interview-me` (Addy Osmani)
- `grill-with-docs` / `grill-me` (Matt Pocock)
- `spec-driven-development`

### Artifact
- `docs/superpowers/specs/<issue>-spec.md`

---

## 2. Stage 2: PLAN (`/plan`)

### Objectives
- Architectural decomposition into small, atomic tasks.
- Explicit definition of failing tests before implementation.

### Skills & Tools
- `planning-and-task-breakdown` (Addy Osmani)
- `writing-plans` (Superpowers)

### Artifact
- `implementation_plan.md` (shared with human for approval)

---

## 3. Stage 3: BUILD (`/build`)

### Objectives
- Atomic, test-driven implementation (Red-Green-Refactor).
- UI follows `vercel-react-best-practices` and UX-parity rules.

### Skills & Tools
- `test-driven-development` (Superpowers / Addy Osmani)
- `subagent-driven-development`
- `using-git-worktrees`
- `vercel-react-best-practices`

---

## 4. Stage 4: VERIFY (`/test`)

### Objectives
- Deterministic terminal proof that 100% of tests pass and build succeeds.

### Command
```bash
npm run typecheck && npm run lint && npm test && npm run build
```

### Skills & Tools
- `verification-before-completion` (Superpowers)
- `browser-testing-with-devtools`

---

## 5. Stage 5: REVIEW (`/review`)

### Objectives
- Mandatory clean-room adversarial subagent audit evaluating `git diff origin/main...HEAD`.

### Subagent Execution
```typescript
invoke_subagent({
  Model: 'pro',
  TypeName: 'self',
  Role: 'Clean-Room Code Reviewer',
  Prompt: 'Evaluate git diff origin/main...HEAD against 4 axes: Spec, a11y, CRDT/Storage, and Backend Security.'
})
```

### Skills & Tools
- `clean-room-review` (.agents/skills/clean-room-review/SKILL.md)
- `code-review-and-quality` (Addy Osmani)

### Artifact
- `docs/reviews/pr-<id>-review.md`

---

## 6. Stage 6: SHIP (`/ship`)

### Objectives
- PR creation, merge, blocker tree cleanup, project board and roadmap update.

### Skills & Tools
- `shipping-and-launch` (Addy Osmani)
- `finishing-a-development-branch` (Superpowers)
- `docs/agents/project-board.sh <issue> Done`
