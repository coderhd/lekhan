# SIL-160 — Login failure surfacing (DEFINE)

Child of SIL-93 · source: SIL-133 triage unfiled observation.

## Problem statement

Audit saw a login 400 (stale E2E credentials) render **no error until re-submit**. Login is the first screen of session one, so a silent failure is a P1 for beta onboarding.

## Verification (live browser, 2026-11-02)

Deliberate invalid credentials against `next dev` + the hosted Supabase project:

- HTTP 400 `Invalid login credentials` → the message **did** render immediately on the first submit after hydration.
- The rendered node had **no `role="alert"` / `aria-live`**, so assistive tech never announced it.
- It rendered **above the email field**, not near the submit control.
- It showed the **raw provider message**, and the catch-all `setError(err.message)` would surface any provider/network string ("Failed to fetch", "Email rate limit exceeded", `AuthApiError: …`) verbatim.
- The server-rendered form had **no `action`**, inputs had **no `name`**, and the submit button was **enabled before hydration**. A click in that window performs a native form submit → reloads `/login`, clears the fields, and drops the failure. This is the mechanism that produces "no error until I press Sign In again": the first press is lost to a page reload, the second lands after hydration.

## Root cause

Two independent defects:

1. **Lost first submit (the reported symptom):** the pre-hydration form is a plain HTML form, so the first eager click/submit navigates instead of calling `signInWithPassword`.
2. **Weak failure presentation (the audit's underlying complaint):** error state existed but was not an alert, sat away from the control that caused it, and echoed provider internals.

## Decision

- Keep the existing Supabase call and analytics event.
- Gate the submit button on hydration (`mounted`) so a pre-hydration press cannot native-submit; guard `handleLogin` against double-submit.
- Map failures through `lib/auth-error-message.ts` to five action-oriented messages; never render raw provider text.
- Render the message as `role="alert"` + `aria-live="assertive"`, immediately above the submit button, referenced by `aria-describedby`.
- Preserve the loading state (`disabled` + `Signing In...` + `aria-busy`).

## Acceptance criteria mapping

| AC | Evidence |
| --- | --- |
| 1. Verify current behavior | Live browser run above; documented gaps. |
| 2. Immediate, inline, plain, non-technical error | `role=alert` above submit; friendly mapping; tests for invalid creds, network, 429, unconfirmed email, unknown fallback. |
| 3. Loading state, no double-submit, accessible error | `disabled`/`aria-busy`/label swap; handler guard; `tests/unit/login-failure.test.tsx`. |

## Out of scope

- Signup/forgot-password error copy (separate surfaces).
- Changing Supabase auth configuration or E2E credential management.
