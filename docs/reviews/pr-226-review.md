# Settings and Workbench clean-room release review

Reviewed branch integration against origin/main through 61dbc02, with the settings-specific delta beginning at 637dcfe. Changes requested.

| Axis | Verdict | Evidence |
| --- | --- | --- |
| Spec and domain | Changes requested | Workspace, editor and graph entries retain their mounted screen in the normal case. A temporary identity lookup failure navigates away from the editor. The legacy billing and transfer links target the correct panels. |
| Frontend and accessibility | Pass | Settings uses a named Radix dialog, keyboard-operable tabs, explicit return focus for desktop and mobile entries, and an independent scroll region. Search maintains input focus while exposing the active result. |
| CRDT and storage | Pass | The branch retains the existing Yjs persistence, encryption, history and sync paths. Model and key controls continue to use the registry and existing encrypted storage. |
| Backend, security and errors | Changes requested | The persistent settings overlay can outlive the authenticated identity that populated it. The initial identity lookup also conflates temporary transport failure and sign-out. |

## Actionable findings

- **P1 — Invalidate account-bound settings on authentication changes.** In components/settings/settings-content.tsx lines 16–32, the component verifies the account once. The global provider clears its dialog on pathname changes only. A same-path sign-out in another tab swaps Home to the landing page while the open dialog still exposes the prior account’s profile, collaborator details and previously loaded provider keys. An account switch also preserves that state. Observe identity changes, discard stale requests and unmount the old SettingsClient before exposing data or actions for another identity. Exercise both the global dialog and direct settings route.
- **P2 — Preserve the editor when identity verification temporarily fails.** In components/settings/settings-content.tsx lines 19–23, a Supabase getUser response with a retryable network error has a null user. Opening Settings then calls router.replace('/login') and unmounts the active editor. Keep the existing dialog error state for temporary failures and handle confirmed session loss separately. Cover a resolved error response from getUser.

The review used the supplied passing typecheck, lint, unit suite and production build results, plus desktop and mobile smoke evidence. The Mac-specific tooltip on the compact header search button is inherited from 637dcfe.

## Final re-review of 9fd88b4

**Approved.** Both release findings are resolved.

| Axis | Verdict | Evidence |
| --- | --- | --- |
| Spec and domain | Pass | A temporary identity lookup failure displays a dismissible alert. Chromium verification preserved the editor URL and draft after Escape. |
| Frontend and accessibility | Pass | The error and signed-out states expose an alert and status respectively. The compact search tooltip now shows the platform shortcut. |
| CRDT and storage | Pass | The follow-up confines changes to account-bound UI state and its lifecycle. |
| Backend, security and errors | Pass | Sign-out clears the previous account. An identity change unmounts the old client, verifies the replacement account, and discards superseded identity and collaborator responses. Confirmed session loss redirects direct settings visitors to login. |

The supplied Chromium cross-tab check confirmed prior profile data disappeared after sign-out. The 31 focused tests, typecheck and lint passed. The full verification rerun was in progress at sign-off.

## Initial integrated verification

Typecheck, ESLint, the full Vitest suite, and the production build exited successfully. Vitest reported 1,532 passes and one skipped live-fixture test across 155 test files.

| Reference | Browser evidence |
| --- | --- |
| 1 and 4 | Settings opens over the workspace, editor, and graph with aligned section navigation and an independent scroll region. Escape and close release the modal and restore focus. |
| 2 and 8 | Provider and model fields have inset arrows. Test and Save have distinct neutral and primary states. The key field and its actions wrap on narrow screens. |
| 3 | The sidebar keeps search and page links visible. The editor title and body share a readable column. An open Settings dialog preserves typed text and the editor instance. |
| 5 | The search icon and input share a focus ring. Arrow keys update the active result, Enter opens it, and Escape restores the trigger. |
| 6 and 7 | The AI Usage panel is absent. The Sarvam key form remains in AI & Models, and active model status stays readable as models change. |

Chromium exercised 1440 px light, 390 px dark, and 320 px light using synthetic account and workspace data. Nested confirmations and role selection kept keyboard focus. Mock provider testing and encrypted fixture storage worked across reopen. The signed-out and transient error cases kept account data and editor state separate.

## Responsive follow-up on 96d8021

Chromium found horizontal overflow at 320 px in the top bar and at 768 and 1024 px while the formatting icon font was unavailable. The top bar now wraps on very narrow screens while retaining the account, theme, and sync controls. The toolbar reserves a glyph-sized space per icon and keeps its accessible button names. Chromium verified that document width equals viewport width at 320, 390, 768, and 1024 px with the font blocked. The scoped independent re-review passed without findings.

## External review dispositions

CodeRabbit’s three findings were addressed in aee510c and 789a3b7. The independent scoped re-review passed. The full rerun passed typecheck, lint, 1,536 tests, and the production build, with one live-fixture test skipped.

- Successful Sarvam revalidation migrates matching legacy plaintext without duplicating connection analytics. The app serializes save, migration, and disconnect through a shared Web Lock where supported. A test verifies that an overlapping disconnect cannot restore the old key.
- The public badge sits beside the editor title and wraps on narrow screens. Chromium verified the public reading layout at 320 and 1440 px.
- Transfer confirmation returns focus to the card heading while its original action is disabled. Cancel returns focus to its trigger. Chromium verified both paths.
- The full suite exposed a delayed Bot autofocus that could take focus after Settings closed. The composer now focuses when its visible portal mounts, and a regression test verifies that closing Settings restores the model picker.
