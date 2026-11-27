# 0004 — Client-direct AI inference routing without a server proxy

Date: 2026-11-27
Status: Accepted
Applies to: H0 AI Provider Registry (epic [#28](https://github.com/coderhd/lekhan/issues/28))

## Context

The August 2026 strategy (`docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md`, §6.1) states that all AI inference goes directly from the client to the chosen provider or local endpoint, and that Lekhan never proxies AI traffic or hosts inference keys. Closed ticket [#104](https://github.com/coderhd/lekhan/issues/104) previously specified an Edge `/api/ai/stream` proxy route for cloud models, leaving a documented conflict in the H0 verification tracker.

## Decision

Keep inference client-direct with zero server-side AI proxy routes:

1. **Browser client (`lib/ai/client.ts`):** Sends chat and model-discovery requests directly from the browser using `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and `redirect: 'error'`, with ordered 429/503 fallback in `lib/ai/fallback.ts`.
2. **Desktop IPC transport (`desktop/provider-transport.ts`):** Uses the Tauri native transport for loopback local servers (`ollama`, `lmstudio`, `llamacpp`) and provider calls in the desktop bundle without exposing browser CORS workarounds.
3. **Encrypted vault sync (`app/api/ai/vault`):** Stores only the user's client-encrypted provider configuration envelope; plaintext keys and prompts never transit Lekhan's Next.js routes.

## Consequences

- No `/api/ai/stream` route is shipped in H0; privacy claims in the strategy and privacy policy match runtime behavior across web and desktop.
- Browser-direct connections require CORS support from the target cloud or local endpoint; non-CORS endpoints remain supported via the desktop writer or local CORS setup instructions (`local-provider-discovery.tsx`).
- Introducing any optional server-side relay for CORS-restricted cloud providers later requires a new ADR and explicit user disclosure.
