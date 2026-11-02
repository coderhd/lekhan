# PR #159 — Clean-room review (SIL-160)

Reviewer: independent adversarial subagent (fresh context), auditing `git diff origin/main...HEAD` on four axes. Date: 2026-11-02.

## Verdict

**CHANGES REQUESTED** on the first pass — no runtime blocker; production fix correct. All requested changes were applied in the same PR.

## Findings and resolution

| # | Axis | Severity | Finding | Resolution |
| --- | --- | --- | --- | --- |
| 1 | Frontend/a11y | Major | Neither `<label>` was associated with its input (no `htmlFor`/`id`), so password was announced as "••••••••". | Added `htmlFor`/`id` + `autoComplete` (`email`, `current-password`). Deliberately **no** `name` attributes: a native GET submit would otherwise put the password in the URL. |
| 2 | Tests | Major | Headline fix (`disabled={!mounted}`) had no test; RTL flushes effects, so removing the gate stayed green. | Added SSR test using `renderToStaticMarkup` asserting the button carries `disabled` before hydration. |
| 3 | Tests | Major | Double-submit test clicked a disabled button (a no-op in jsdom), so it only proved the attribute, not the handler guard. | Test now dispatches `fireEvent.submit(form)` twice and asserts one `signInWithPassword` call. Fails if the `if (loading) return` guard is removed. |
| 4 | Backend/errors | Minor | `finally { setLoading(false) }` re-enabled the button after `router.push('/')`, allowing a second auth call + duplicate `login_completed` during navigation. | `loading` is cleared only on failure; success keeps the control locked until the route takes over. New test asserts the post-success locked state and exactly one call/event. |
| 5 | Frontend/a11y | Minor | Decorative error SVG had no `aria-hidden`, so AT could announce a stray graphic. | `aria-hidden="true" focusable="false"` added (also to the field icons). |
| 6 | Frontend/a11y | Nit | `role="alert"` implies `aria-live="assertive"`; explicit attribute could double-announce on older AT. | **Kept** — SIL-160 AC3 explicitly requires `role=alert` **and** `aria-live`. Asserted as `assertive`. |
| 7 | Tests | Nit | Mocks are plain `Object.assign(new Error(...))` rather than `AuthApiError`/`AuthRetryableFetchError` instances. | Accepted: the classes are not re-exported by `@supabase/supabase-js`; the factory mirrors the `{ name, message, status, code }` shape the mapper reads. Also asserted the `{ email, password }` call shape. |
| 8 | Frontend/a11y | Nit | First paint shows a dimmed disabled CTA on slow connections. | Accepted as-is; the form cannot work pre-hydration (no `action`/`name`), and post-hydration the gate lifts immediately. |
| 9 | Spec | Nit | AC1 evidence in the spec is narrative, not a HAR/screenshot artifact. | Accepted for a P1 one-file fix; evidence recorded below. |

## Verified clean

- **Spec/AC:** all three acceptance criteria met; no conflict with `CONTEXT.md` or `lib/tier-limits.ts` (login precedes workspace creation).
- **CRDT/storage:** no impact — no IndexedDB, sync hub, or CRDT path touched.
- **Security:** raw provider text never rendered; unknown thrown values fall through to generic copy; no account enumeration (`email_not_confirmed` only returned after password validation); analytics fires only on success through the sanctioned `track()` seam.
- **React/Next correctness:** no hydration mismatch (server and first client render both `disabled`), no `useEffect` cleanup needed, `'use client'` present.

## Post-fix verification

- Live browser (dev + hosted Supabase), bad credentials: alert "Email or password is incorrect. Please try again." immediately, `role=alert`, `aria-live=assertive`, above submit, `aria-describedby=login-error`, button re-enabled after failure.
- SSR HTML: submit `disabled`; password input has no `name`.
- `tests/unit/login-failure.test.tsx`: 7/7.
- Full `npm test`: 100 files / 874 tests passed. `tsc --noEmit`, ESLint clean. `next build` succeeded (exit 0).
