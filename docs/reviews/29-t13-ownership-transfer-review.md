# Clean-Room Review — T13: Ownership transfer (US-8 / PDEC-11)

- **Issue:** SIL-123 (BUILD T13, epic SIL-32 / #29)
- **Branch:** `plan/29-real-billing`
- **Reviewer:** fresh-context Clean-Room Reviewer subagent (writer ≠ verifier)
- **Gate:** `typecheck` PASS · `lint` PASS · **99 files / 867 tests PASS** · `build` PASS

## Verdict

**APPROVE after fixes.** Cycle 1 was CHANGES-REQUESTED with two blocking defects
(payment-identity carry-over; the accept link landing on the wrong tab) and
several majors. Both blockers are fixed and re-verified; the remaining majors
are either fixed or explicitly deferred with an owner, below.

## Cycle 1 findings → disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | BLOCKING | `owner_id` swap left `workspace_plans.gateway_customer_id` pointing at the predecessor, so the successor's portal call could open the old owner's saved cards/invoices. | **FIXED** — accept now clears `gateway_customer_id` after the swap (the subscription ref stays, carrying the paid remainder per PDEC-11; the successor's own customer is created at their next checkout). Portal now fails closed (`no_billing_account`) instead of exposing the predecessor. Test pins the write. |
| 2 | BLOCKING | The generated `?transfer=` link opened `/settings` on the profile tab, where the accept card is never mounted. | **FIXED** — settings reads `?transfer=` on mount and selects the collaborators tab before the card can render. |
| 3 | MAJOR | The provider cancel ran before the HMAC secret was validated; an unconfigured deployment could cancel a live subscription and then 503. | **FIXED** — `transferSecret()` is resolved at the top of `initiate`, before any DB/provider call. Test pins "provider never called, nothing mutated". |
| 4 | MAJOR | `pages.owner_id` is not reassigned, so page-level access does not move with workspace billing ownership. | **DEFERRED (PO/TL decision)** — T13's mandate is the atomic billing-root swap; page/content ownership is a separate model (H2 team workspaces #49). Copy no longer promises access ("nothing is deleted… stays on the workspace"), and this is flagged to the PO as a Phase-5 input. |
| 5 | MAJOR | No persisted pending transfer → an earlier A→B token stays valid for 7 days after re-initiating to C. | **DEFERRED (needs schema)** — token replay can never double-take (atomic `WHERE owner_id = from` + one-time acceptance), but revocation needs a pending-transfer row or workspace epoch column. Flagged to TL as a schema follow-up; 7-day TTL bounds the window. |
| 6 | MAJOR | The API accepts any existing user id, while the UI called them "collaborator". | **PARTIAL** — successor ids are UUID-validated; the route remains owner-initiated + successor-accepted (no silent takeover). The UI now says "an existing Lekhan account you trust" and lists collaborators as the practical path. Membership enforcement needs a workspace-members model (H2). |
| 7 | MAJOR | DB/provider error text was echoed to clients. | **FIXED** — `unwrap` logs detail server-side and returns a generic message. |
| 8 | MINOR | Razorpay accept "re-verify" re-reads the stored flag, not provider truth. | **ACCEPTED** — inherent to SIL-56 R-CANCEL-FLAG (Razorpay never echoes the flag); the accepted 2xx is the sanctioned provenance. |
| 9 | MINOR | TOCTOU between detach verification and the owner swap. | **ACCEPTED** — the checkout gate re-verifies at purchase time; the swap itself is atomic. A portal resume in the gap is a live-owner action, not a third party. |
| 10 | MINOR | Token stays in the query string. | **ACCEPTED for H0** — needed for the two-step handover; 7-day HMAC token bound to the successor account. Stripping the URL before acceptance would break reload. |
| 11 | MINOR | `successorUserId` not UUID-validated. | **FIXED** — validated up front (404 `successor_not_found`). |
| 12 | MINOR | No route-level tests. | **FIXED** — `tests/unit/billing-transfer-route.test.ts` pins 401, invalid action, session-derived workspace (body id ignored), error mapping, accept path. |
| 13 | MINOR | `planPreserved: true` unconditional when no plan row exists. | **ACCEPTED** — `workspace_plans` is keyed by workspace and backfilled; a missing row means Free, and the workspace continuity claim still holds. |

## Pinned guarantees

- **Double billing impossible:** a live subscription is cancelled and, on Stripe,
  a second read-back must report `cancel_at_period_end` before a token is issued;
  acceptance re-checks and rejects `live`. Razorpay records the provider-acked
  instruction (SIL-56 provenance).
- **No silent takeover:** owner-only initiation returns a signed, 7-day,
  successor-bound token; the successor must be signed in as that account.
- **Replay-safe:** acceptance performs a conditional `owner_id` swap and fails
  with 409 when the row no longer matches.
- **Plan continuity:** the workspace row is untouched by transfer, so the plan
  and paid period carry over; the successor adds payment to renew.
- **No content deletion:** transfer touches billing identity only.
