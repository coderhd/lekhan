# SIL-281: dashboard layout and verification follow-up

Continue SIL-231 at c42d8c6; exclude #146. No storage/API behavior changes.

Acceptance criteria:
- At 320px and 390px, document scrollWidth equals viewport width and header controls remain reachable.
- Inbox loading, empty, error, and populated (five previews plus overflow) preserve the downstream vertical position.
- A dashboard control responds to an actual click in under 1000ms in development and production.
- Typecheck, lint, unit tests and production build pass, resolving the three baseline billing query-mock failures.
- Independent clean-room review evaluates the branch and records findings before parent review.

Design: reserve two 44px header rows below sm, retaining one row from sm upward. Reserve a 192px inbox content region, sufficient for five single-line previews and overflow. Keep retry and status semantics. Repair only the test double for billing query chaining.
