# Virtual Startup Organization & Multi-Agent Protocol

Enterprise-grade software delivery protocol mimicking a high-velocity, disciplined software organization (inspired by American Express enterprise rigor and modern startup execution).

---

## 1. The Virtual Organization Roster

```text
               ┌────────────────────────┐
               │ Product Owner / PM     │
               │ (PRD, Roadmap, Epics)  │
               └───────────┬────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
  ┌──────────────────────┐    ┌──────────────────────┐
  │ Tech Lead / Arch     │    │ QA Lead / Gatekeeper │
  │ (ADRs, Types, Seams) │    │ (Acceptance, Tests)  │
  └──────────┬───────────┘    └──────────┬───────────┘
             │                           │
             └─────────────┬─────────────┘
                           ▼
              ┌──────────────────────────┐
              │ Dev Engineer             │
              │ (Atomic TDD, Code Slices)│
              └────────────┬─────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
  ┌──────────────────────┐    ┌──────────────────────┐
  │ DevOps / Release     │    │ Marketing / Growth   │
  │ (CI/CD, Deploy, DB)  │    │ (Changelog, Launch)  │
  └──────────────────────┘    └──────────────────────┘
```

---

## 2. Role Specifications & Deliverable Artifacts

### 1. Product Owner / Product Manager (`po_pm`)
* **Role**: Business requirements, customer value, feature scoping, and prioritization.
* **Input**: User vision, market feedback, defect escalations, roadmap goals.
* **Deliverable Artifacts**:
  - `docs/prd/<feature>-prd.md` (Product Requirements Document with User Stories)
  - `docs/roadmap.md` (Milestone planning & dependency ordering)
  - GitHub Issues tagged with `epic` and `user-story`.
* **Definition of Done**: Clear acceptance criteria, out-of-scope boundaries, user persona definition, and business value metric.

### 2. Tech Lead / Principal Architect (`tech_lead`)
* **Role**: Technical architecture, deep module decomposition, interface contracts, coding standards.
* **Input**: PO/PM PRDs, scaling requirements, infrastructure constraints.
* **Deliverable Artifacts**:
  - `docs/adr/<number>-<slug>.md` (Architectural Decision Records)
  - `types.ts` / Interface definitions (contracts preceding implementation)
  - `docs/superpowers/plans/<date>-<feature>.md` (Technical implementation plans)
* **Definition of Done**: Clean seams defined, deep module boundaries established, zero ambiguity on data flow and error models.

### 3. QA Lead / Test Automation Engineer (`qa_engineer`)
* **Role**: Acceptance criteria matrices, automated test authoring, regression suite maintenance, formal release sign-off.
* **Input**: PRD user stories, Tech Lead interface contracts, Dev PR diffs.
* **Deliverable Artifacts**:
  - `docs/qa/matrices/<feature>-test-matrix.md` (Edge case & acceptance matrices)
  - Automated test files in `tests/unit/`, `tests/integration/`, `tests/e2e/`
  - Defect tickets and `docs/reviews/pr-<id>-review.md` audit findings.
* **Definition of Done**: 100% test coverage of acceptance criteria, passing full test suite, clean-room adversarial review sign-off.

### 4. Senior Software Engineer / Developer (`dev_engineer`)
* **Role**: Atomic test-driven implementation (Red-Green-Refactor), clean code, zero regressions.
* **Input**: Tech Lead interfaces, QA acceptance criteria, feature branch worktree.
* **Deliverable Artifacts**:
  - Production source code adhering to `vercel-react-best-practices` and repo standards.
  - Granular, atomic unit test suites proving code correctness.
  - Git commits on feature branch `feat/<issue>-<slug>`.
* **Definition of Done**: Clean `tsc --noEmit`, `eslint .`, `vitest run`, and `next build` with zero regressions.

### 5. DevOps & Release Engineer (`devops_engineer`)
* **Role**: CI/CD automation, database migrations, release cutovers, production deployment safety.
* **Input**: QA-approved pull requests, Supabase database migrations, environment variables.
* **Deliverable Artifacts**:
  - `.github/workflows/` CI/CD pipeline automation.
  - `supabase/migrations/` validated declarative schemas and rollback scripts.
  - Release tagging (`git tag vX.Y.Z`) and deployment health checks.
* **Definition of Done**: Zero-downtime migrations, automated build verification, production deployment verified.

### 6. Marketing & Growth Lead (`marketing_growth`)
* **Role**: Value communication, product launch copy, changelogs, user on-ramps, positioning.
* **Input**: Shipped features, PRD value propositions, release milestones.
* **Deliverable Artifacts**:
  - `docs/changelog/<version>.md` (User-facing release notes)
  - Landing page copy, conversion elements, feature comparison matrices.
  - Distribution threads and user onboarding documentation.
* **Definition of Done**: High-signal developer-centric release announcement, updated website copy, zero marketing fluff.

---

## 3. Enterprise Handoff Pipeline

```text
[PO/PM] ──(PRD & User Stories)──▶ [Tech Lead] ──(Interface Contracts)──▶ [QA] ──(Test Matrix)──┐
                                                                                                  │
┌─────────────────────────────────────────────────────────────────────────────────────────────────┘
▼
[Dev] ──(Atomic TDD Build)──▶ [QA Gate] ──(Adversarial Sign-off)──▶ [DevOps] ──(Deploy)──▶ [Marketing] (Launch)
```

1. **Step 1 (Requirements)**: PO writes PRD with numbered user stories and business metrics.
2. **Step 2 (Architecture)**: Tech Lead specifies the interface contract (`types.ts`) and creates ADR if architectural boundaries change.
3. **Step 3 (QA Preparation)**: QA writes the test matrix and verifies acceptance criteria before code is written.
4. **Step 4 (TDD Build)**: Dev creates a worktree and implements Red-Green-Refactor against the interface and test matrix.
5. **Step 5 (QA Gatekeeper)**: QA performs adversarial clean-room review and runs full automated regression suite.
6. **Step 6 (Release & Deploy)**: DevOps cuts release, verifies DB migrations, and triggers deployment.
7. **Step 7 (Market Launch)**: Marketing drafts changelog and updates user-facing documentation.
