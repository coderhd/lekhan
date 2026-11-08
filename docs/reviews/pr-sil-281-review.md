# SIL-281 independent clean-room review

Reviewed 2026-11-08 by an independent review agent. Application and test files were read only; this review artifact is the only reviewer edit. The review covers `git diff origin/main...HEAD` at `c42d8c6` and the SIL-281 uncommitted continuation, including the new browser spec. Both the source worktree and isolated clone resolve `origin/main` to `29edee245bd6f867cfa08ac1795fd15232fd773d`. Newer commits on main are not treated as changes introduced by this branch.

Inputs: `AGENTS.md`, `CONTEXT.md`, `docs/superpowers/specs/sil-281-spec.md`, `implementation_plan.md`, ADRs 0001/0004, `lib/tier-limits.ts`, the changed components/styles/tests, and the Playwright configuration and launch-failure artifact.

## Clean-room review summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | FAIL | Runtime acceptance evidence is missing. The identified browser configuration defect was fixed and independently rechecked. No confirmed product/spec or ADR invariant defect found in static review. |
| 2. Frontend & accessibility | PASS | Static scope only: native controls and existing retry/status semantics remain. Mobile row and inbox reserve changes are coherent; browser geometry, reachability and click timing remain unverified. |
| 3. CRDT & storage | PASS | No CRDT, IndexedDB, snapshot, compression, retention or storage write behavior changed. |
| 4. Backend & security | PASS | No production API/auth/query/error handling changes. Billing repair is confined to the query test double; tier limits and hub admission remain untouched. |

Overall review gate: **FAIL / pending runtime verification**. A static frontend pass does not satisfy the browser acceptance criteria. No unresolved confirmed code defects remain from this review.

## Findings and disposition

### RESOLVED MEDIUM — New browser cases targeted a port the default runner did not manage

- **Original file:** `tests/e2e/dashboard-cls.spec.ts:41`; related `playwright.config.ts:11` and `playwright.config.ts:22`.
- **Issue:** The new spec is discovered by the default Playwright configuration but falls back to `http://localhost:3281`. That configuration starts and configures `http://localhost:3000`. With no `DASHBOARD_QA_URL` override and no separately started 3281 server, these twelve cases navigate to an unavailable port rather than the configured app. The dedicated `dashboard-qa.config.ts` also relies on a manually started server and does not resolve the default-run mismatch.
- **Disposition:** The implementer renamed the test to `tests/e2e/dashboard-cls.qa.ts`, which the default `.spec`/`.test` discovery excludes, changed navigation to `page.goto('/')`, and made `dashboard-qa.config.ts` manage a development server at port 3281 or a production server at 3282 (`DASHBOARD_QA_MODE=production`). The reviewer independently read these changes. The dedicated config explicitly matches the `.qa.ts` file and supplies its base URL and synthetic API environment. This resolves the static integration finding.
- **Evidence classification:** Confirmed static test configuration defect; not a product runtime failure.

## Verification evidence still required

These are missing evidence, not inferred product defects:

- The existing browser failure artifact shows Chromium terminating at `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)` before page creation. No viewport, control-bound, inbox geometry/CLS or click measurement was produced. Connected browser use is also unavailable under the session's approval policy. This review did not rerun browser launch or claim a runtime pass.
- Run the corrected deterministic spec against both development and production. Record 320px/390px viewport versus document scroll width, reachable header control bounds, loading-to-empty/populated/error geometry and actual click-to-dialog timing below 1000ms. Build production with the synthetic `NEXT_PUBLIC_SUPABASE_*` settings before starting it; start-time variables do not replace already bundled client configuration. The optional overflow coverage suggestion is resolved: the reviewer reread the latest `tests/e2e/dashboard-cls.qa.ts`, which explicitly asserts both five populated rows and the visible `+2 more pending` indicator.
- Unit tests check retained `min-h-48` and responsive header classes; JSDOM class assertions do not prove rendered height, overflow, reachability or timing.
- Recorded terminal evidence was independently inspected without rerunning the full suites: `$PAPERCLIP_SCRATCH_DIR/full-tests.log` reports 140 passing test files, 1438 passing tests and one skipped test in 251.62s; `$PAPERCLIP_SCRATCH_DIR/build.log` records successful compilation, TypeScript completion and all 33 static pages generated. The implementer reports the bounded-worker unit run and production build exited 0; an initial unconstrained unit run had three unrelated 5000ms timeouts. This supports unit/build verification, not browser behavior. Earlier typecheck/lint logs contain their commands without errors; the implementer's final typecheck/lint refresh after the browser-spec edits was still running when this addendum was recorded. Attach that final exit status before acceptance.

## Static product assessment

- The header reserves two `min-h-11` rows below `sm`, switches to one row at `sm`, removes the unconditional mobile action minimum width, and constrains the desktop left slot with `min-w-0`. The dashboard action group uses a smaller mobile gap. These changes address the identified width pressure without removing controls.
- Inbox content states share a 192px minimum region. At normal sizing, five single-line 28px preview rows, four 4px gaps and a 20px overflow label require 176px. Added `min-w-0` permits preview truncation rather than width expansion. Loading/empty/error retain their status, alert and retry semantics. Actual font and viewport geometry still require browser measurement.
- The billing test double adds the missing `.or()` chain and an awaited array result while leaving production code unchanged. No confirmed defect was found in this limited repair.
- No additional confirmed product correctness, accessibility, CRDT, storage or backend security findings were found in the reviewed scope.
