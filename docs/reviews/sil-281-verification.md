# SIL-281 verification evidence — 2026-11-08

Branch: `fix/sil-281-dashboard-verification`, continued from `c42d8c6`.
Workspace: `/Users/harshdave/Desktop/projects/Lekhan/.paperclip-scratch/sil-281`.
Scope excludes #146. No PR opened or merge attempted; runtime review gate remains pending.

## Changes

- Header reserves two 44px rows below sm, with 16px side padding and compact dashboard action gaps. Desktop retains one row and reserved action dimensions. Logo and controls no longer compete for one narrow row.
- Inbox keeps one 192px preview region across loading, empty, populated and error states. Five single-line previews plus overflow require 176px at default sizing. Status/alert/retry semantics remain.
- Billing query double now supports the existing conditional `.or()` reservation and awaited array results. Production billing code is unchanged.

## Terminal evidence

- RED: restored both components to c42d8c6 with new regression tests present: 4 failures (mobile header reserve and inbox empty/populated/error region), 15 passes. Restored fixes afterward.
- GREEN: focused header, inbox and billing tests: 47 passed across 3 files.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0.
- `npm test -- --maxWorkers=2 --minWorkers=1`: exit 0; 140 files passed, 1438 tests passed, 1 skipped (1439 total), 251.62 seconds.
- `npm run build`: exit 0; Next.js 16.3.2 Turbopack; compiled in 119 seconds, TypeScript completed, 33 static pages generated. Installed Next version matches package-lock.json.
- Initial unbounded full run: 1435 passed, 3 timeouts at 5000ms in unrelated Notion import and cron tests. Capped full rerun passed without timeout changes or test exclusions.

## Browser evidence and unresolved acceptance

Chromium failed before creating a page: `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`. The connected browser tool also returned `MCP tool call requires approval, but approval policy is never`. These are execution restrictions; no browser pass or timing is claimed.

Still required from QA on a permitted runner:

| Acceptance | Evidence required |
| --- | --- |
| 320px / 390px header | document scrollWidth equals viewport; header controls within bounds and actionable |
| Inbox data states | stable card position/height and downstream position through empty/populated/error resolution; 7 captures with 5 shown and +2 overflow |
| Dashboard CLS | <= 0.1 overall and no layout shift attributable to inbox resolution |
| Dev and prod interactions | actual Quick capture click opens and focuses the dialog, with painted response under 1000ms |

The independent clean-room review found no unresolved confirmed code defects, but its gate remains FAIL pending the runtime evidence above. See [review](pr-sil-281-review.md).

## Reproducible browser run

The dedicated `dashboard-qa.config.ts` owns its local server and synthetic API environment. All Supabase traffic is fulfilled by the test, no real user/workspace is needed. The `.qa.ts` suffix keeps these fixtures out of the default authenticated E2E suite. Twelve cases cover 320/390/768/1280px and empty/populated/error; each holds the 14-day inbox response until loading geometry is captured, checks preview overflow, measures CLS, checks control actionability, and measures click-to-focused-dialog plus two animation frames.

```sh
npx playwright test -c dashboard-qa.config.ts
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-qa-key npm run build
DASHBOARD_QA_MODE=production npx playwright test -c dashboard-qa.config.ts
```

Production must be built with those synthetic NEXT_PUBLIC settings because the client bundle inlines them. Both runs print one JSON measurement record per case. The harness itself has typechecked and linted; it has not completed a browser run in this sandbox.
