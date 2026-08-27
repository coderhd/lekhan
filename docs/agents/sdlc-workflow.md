# SDLC Workflow: Roles, Skills & Gates

Solo-builder adaptation of an enterprise SDLC (Confluence → Epics/Stories → Tech Lead Review → Shift-Left QA Plan → Dev TDD → QA Verification Gate → Release), implemented as six dedicated subagents with local skill tooling and the GitHub issue tracker / project board. The tracker is the single source of truth (`docs/agents/issue-tracker.md`).

---

## 1. Separation of Duties

Separation of duties only works if the agent that approves a thing is not the same agent that built it:
- **Dev never verifies its own work.**
- **Tech Lead and QA never write application/feature code.**
- **PO/PM never writes code or approves its own stories as Done.**

---

## 2. Roles, Tool Boundaries & Local Skills

| Role | Agent File | Owns | Can Touch | Cannot Touch | Local Skills Used |
|---|---|---|---|---|---|
| `po-pm` | `.claude/agents/po-pm.md` | `docs/roadmap.md`, Epics, Stories, PRDs | Docs, `gh issue`/`gh project` | App code | `interview-me`, `brainstorming`, `idea-refine`, `grilling`, `spec-driven-development`, `writing-plans` |
| `tech-lead` | `.claude/agents/tech-lead.md` | `docs/adr/`, `CONTEXT.md`, Coding Standards | Docs, read-only code | App code writes | `codebase-design`, `api-and-interface-design`, `domain-modeling`, `documentation-and-adrs`, `improve-codebase-architecture` |
| `qa` | `.claude/agents/qa.md` | Test plans, automation suite, defects, QA Sign-off | Test code, `gh issue` (defects), run tests | App/feature code | `clean-room-review`, `code-review`, `code-review-and-quality`, `a11y-debugging`, `web-design-guidelines`, `browser-testing-with-devtools` |
| `dev` | `.claude/agents/dev.md` | Implementation, atomic TDD, PRs | App code, unit tests, PRs | Merging without QA Sign-off | `tdd`, `test-driven-development`, `vercel-react-best-practices`, `subagent-driven-development`, `using-git-worktrees`, `frontend-ui-engineering` |
| `devops` | `.claude/agents/devops.md` | Env config, deploy pipeline, DB migrations | Infra/deploy config, `project-board.sh` | App feature code | `deploy-to-vercel`, `supabase`, `supabase-postgres-best-practices`, `ci-cd-and-automation`, `wizard`, `git-workflow-and-versioning` |
| `marketing` | `.claude/agents/marketing.md` | `docs/marketing/`, positioning, changelogs | Docs, web search, landing copy | Code, issue state | `writing-website-content`, `hallmark`, `impeccable` |

---

## 3. The 5-Stage Gate Sequence

```text
[Backlog] ──(PO: Definition of Ready)──▶ [Ready]
                                           │
┌──────────────────────────────────────────┘
▼
[Tech Lead Review] ──(Feasibility/Gaps)──▶ [QA Test Plan] ──(Shift-Left AC)──▶ [In Progress (Dev TDD)]
                                                                                     │
┌────────────────────────────────────────────────────────────────────────────────────┘
▼
[In Review (PR Open)] ──(QA Automation & Clean-Room Sign-off)──▶ [Done] ──(DevOps)──▶ [Production Release]
```

1. **Backlog → Ready** (`po-pm`): Gate: Issue meets Definition of Ready (Problem statement, Given/When/Then AC, Linked Epic, ADR flag).
2. **Ready → In progress** (`tech-lead` + `qa`): 
   - `tech-lead` reviews architecture fit & implementation gaps.
   - `qa` immediately posts a **concrete test plan comment** on the issue before `dev` writes any code (committing to what "done" means in advance).
3. **In progress → In review** (`dev`):
   - `dev` implements Red-Green-Refactor against the interface contract and QA test plan in an isolated worktree.
   - `dev` opens PR, moves issue to `In review`.
4. **In review → Done** (`qa`):
   - `qa` runs full automation suite and evaluates against the pre-committed test plan.
   - Pass $\rightarrow$ move to `Done`.
   - Fail $\rightarrow$ open `defect` issue (`Defect of #<story>`), move story back to `In progress`, block merge.
5. **Release** (`devops`):
   - Promotes a batch of `Done` work to staging/production, validates DB migrations, checks logs.

---

## 4. Definition of Ready (Checked by `po-pm` before moving to Ready)

- [ ] Problem statement: who hits this, what breaks without it
- [ ] Acceptance criteria written as Given/When/Then
- [ ] Linked epic (`Part of #<epic>`)
- [ ] ADR reference if the change touches existing architecture

---

## 5. Definition of Done (Checked by `qa` before moving to Done)

- [ ] Every acceptance criterion has a passing automated test, committed alongside the feature
- [ ] Adversarial clean-room code review completed (no open blocking issues)
- [ ] No open `defect` issues linked to this story
- [ ] `CONTEXT.md` updated if the change introduces or modifies domain vocabulary

---

## 6. Defects

- **Label**: `defect`
- **Body**: Starts with `Defect of #<story>`
- Triaged according to `docs/agents/triage-labels.md` and prioritized in `docs/roadmap.md`.
