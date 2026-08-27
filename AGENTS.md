# AGENTS.md

## Agent skills

### Issue tracker

Issues, specs, and roadmap tickets for this repo live as GitHub issues, tracked via the `gh` CLI (`gh` is installed at `/opt/homebrew/bin/gh` — not on the default PATH in this shell). See `docs/agents/issue-tracker.md`.

Every item on the Lekhan GitHub project board moves through `Backlog → Ready → In progress → In review → Done`, and the board's Status column is always kept truthful to the work actually being done — move items with `docs/agents/project-board.sh <issue> <status>`. See the "Project board lifecycle" section of `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.

## Development workflow (mandatory skill + hygiene gates)

These steps are non-optional per ticket. Skipping any of them is a process bug, even when the code is correct.

### Before implementing a ticket

1. Read the ticket body + its spec section; restate acceptance criteria as a checklist.
2. Invoke `superpowers:test-driven-development` (or `tdd`) before writing implementation code for anything with logic; UI tickets additionally invoke `frontend-design` or `ui-ux-pro-max` and run the #79 UX-parity checklist.
3. If the ticket touches sync/storage/AI-provider seams, read the relevant ADRs in `docs/adr/` first.

### Before opening the PR

4. Run the full verification suite (`npm run typecheck && npm run lint && npm test && npm run build`) and state results explicitly.
5. **Clean-Room Subagent Review Gate**:
   - Dispatch an independent adversarial review subagent (`invoke_subagent` with `Model: 'pro'`) evaluating `git diff origin/main...HEAD`.
   - The subagent audits changes across 4 axes:
     1. **Spec & Acceptance Criteria** (Issue requirements, CONTEXT.md, and ADR invariants).
     2. **Frontend & Accessibility** (Keyboard navigation, ARIA roles, React 19/Tiptap 3 lifecycle cleanups).
     3. **CRDT & Storage** (IndexedDB transaction atomicity, binary delta compression fidelity).
     4. **Backend Security & Errors** (Query error propagation, storage failure rollback).
   - Triage and fix all valid findings, then re-run the full verification suite.
6. Invoke `verification-before-completion` mindset: no "done" claims without command output proving them.

### At merge time (the step that was missed)

6. **Dependency hygiene audit** (see `docs/agents/issue-tracker.md`): after closing any issue,
   - remove its outgoing blocker edges from children (`DELETE /issues/<child>/dependencies/blocked_by/<db-id>`),
   - sync children's `Blocked by` body lines,
   - run the audit loop over all open issues: no open issue may list a closed blocker.
7. Close the ticket, move board status to Done, update epic bodies and `docs/roadmap.md`, commit doc changes to main.
8. Periodic hygiene sweep: orphaned branches deleted, stale Dependabot PRs triaged with a decision, labels truthful (`needs-spec` removed once specced).
