# SIL-281 implementation plan

1. Reproduce header/inbox regression in unit tests and reproduce baseline billing failures.
2. Use separate reserved mobile header rows and one inbox preview region across states; repair the billing query double.
3. Exercise the real dashboard in Chromium with deterministic synthetic API responses. Record viewport/scrollWidth, control bounds and click response, and delayed inbox transition geometry/CLS for empty, populated and error states in dev/prod.
4. Run npm run typecheck && npm run lint && npm test && npm run build.
5. Commit, request independent clean-room review, resolve findings, hand branch and evidence to SIL-231. Do not merge.
