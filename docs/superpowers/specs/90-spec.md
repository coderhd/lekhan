# Spec — #90 H0 Observability baseline: Sentry (app + sync server) + Better Stack

- **Status**: DEFINE **rev 2** — TL-APPROVED via [SIL-110](/SIL/issues/SIL-110) (findings B1–B5
  applied; review record: `docs/reviews/spec-90-tl-review.md`) — pending QA shift-left test plan
- **Epic**: [coderhd/lekhan#90](https://github.com/coderhd/lekhan/issues/90) · **Author**: Product
  Owner (`po-pm`, rev 1, 2026-10-27) · **Reviewer**: Tech Lead (`tech-lead`, rev 2, 2026-10-27)
- **Invariants honored**: `CONTEXT.md` language (workspace/page, never vault/document/note); ADR 0004
  (server-hub CRDT topology — the hub is production critical path); ADR 0001/0002 (encryption at
  rest, retention); ADR 0003 (desktop sidecar/WAL is H1 scope, epic #43 — not observable here).

## 1. Problem

Private beta (SIL-96/SIL-7) launches with no error visibility on the app or the hub, and no durable
latency evidence against the H0 budgets audited in SIL-50. Every production failure lands in support
DMs instead of a dashboard — including the hub's *silently swallowed* non-critical failures
(graph-index, retention: `console.warn` only today). Beta can't credibly start.

## 2. Goals

G1. Errors and performance traces from the Next.js app (browser + node runtime) AND the hub (the
    single `server/index.js` process: y-websocket relay + in-process persister + retention sweep)
    report to Sentry.
G2. Structured logs drain to Better Stack with a correlation id (`request_id`/`run_id`) minted at
    entry points (API route / hub connection) and propagated on sync calls.
G3. Failure states on the sync seam are distinguishable, each with its own Sentry fingerprint:
    relay failure (upgrade / load-shedding rejection / oversized payload), critical persist
    failure (snapshot upload, legacy DB write, shutdown-flush, bind-state download), and
    non-critical persister failures (graph-index, retention) surfaced as `warning`-level issues.
G4. Zero page content ever leaves the device in telemetry (privacy claim to be tested in SIL-96
    interviews must survive our instrumentation).
G5. Baseline alerts and uptime monitors route to the team channel; beta window covered.

## 3. Non-goals

- Custom dashboards beyond Sentry default + 3 baseline alerts.
- Telemetry replay beyond a 7-day offline buffer (deeper offline replay defers to H1 with the
  desktop sidecar, epic #43).
- Public status page for beta (public comms commitment is marketing-owned; Better Stack offers it
  as a toggle post-beta if wanted).
- Better Stack alert escalation policies.
- Profiling / session replay (cost + privacy surface; revisit post-beta).

## 4. Design

- **SDKs**: `@sentry/nextjs` (browser + node configs split) for the app; `@sentry/node` initialized
  **once** in the hub process (`server/index.js`) covering relay, persister, and retention sweep —
  there are no separate worker processes to instrument. `@sentry/opentelemetry-node` only if the
  relay needs request-level traces (decide in BUILD). Next.js is 16.2.10: pin a compatible SDK
  version and verify instrumentation conventions against `node_modules/next/dist/docs/` (T2n gate).
- **DSN & tokens**: the browser DSN ships in the client bundle (`NEXT_PUBLIC_*`) — DSNs are
  public-by-design ingest identifiers; everything secret (Better Stack source token, auth keys)
  stays server-side env only (`SENTRY_DSN` for node+hub, `BETTER_STACK_SOURCE_TOKEN`). Browser
  config hardcodes `sendDefaultPii: false`.
- **Browser log drain**: no Better Stack token ever reaches the bundle; browser structured logs
  drain through the Next.js node runtime (route-handler forwarder), carrying the correlation id.
- **Sampling**: traces 10% baseline; errors 100%; performance traces always for the sync seam
  (hub connections, persist path) via `tracesSampler`.
- **Privacy guardrails (G4 hard gate)**
  - `beforeSend`/`beforeBreadcrumb` scrubbers drop any payload field containing page/workspace
    names; scrubbing is O(payload) with no deep traversal of document bodies (content dropped
    wholesale, never filtered) so the editor main thread is never blocked.
  - Unit tests assert no Yjs binary, page title, workspace name, or markdown fragment can appear in
    any telemetry payload.
  - No page content, user keys, or BYOK provider keys in any log line; log scrubbing helper shared
    app + hub.
- **Release hygiene**: release tagged with git SHA for **both** deploy targets — Vercel (app) and
  the hub (no hub deploy pipeline config exists in-repo; T1r wires tagging wherever the hub ships,
  else hub errors can't be verified against a release).
- **3 baseline alerts** (Sentry): new issue in app runtime OR hub; sync-seam error rate > threshold
  in 5 min; p95 snapshot-upload latency breach of the H0 budget (number pulled from the SIL-50
  method and recorded here at BUILD). The upload is a background debounce save, not a routed
  transaction — BUILD must wrap the upload step in a span (or custom metric) and alert on that.
- **Uptime monitors** (Better Stack): hub TCP/ws reachability + app URL, alerting through the same
  team-channel routing as G5. (The relay is ws-only today; an HTTP health endpoint is optional and
  not required for this baseline.)

## 5. Edge cases interrogated

- **Offline (DSN set, network down)**: telemetry buffers locally up to 7 days, drop-oldest, and
  never blocks the editor main thread. Browser offline transport is experimental in current Sentry
  SDKs — if unstable at the pinned version, H0 degrades to in-memory buffering only; BUILD records
  the decision here.
- **Nil DSN**: `SENTRY_DSN` unset ⇒ SDK fully disabled, zero egress and zero buffering — covers
  local dev, AGPL forks, and any future self-host build (A3 tests this). There is no self-hosted
  product mode and no "BYOK tier" (BYOK is an AI access mode, not a tier).
- **Relay restart storms**: dedupe identical error groups server-side; fingerprint =
  endpoint/component + error-class (not stack text) so a restart loop cannot blow out quota.
- **Failure-state separation (G3)**: Supabase Storage snapshot-upload failure vs relay failure vs
  non-critical index/retention failure must produce **distinct fingerprints**; non-critical
  failures are *captured* (warning level), not swallowed — today they exist only as
  `console.warn`.

## 6. Acceptance criteria (Given/When/Then)

- **A1** — *Given* a staged deploy with DSNs set, *when* a seeded error is raised in the app
  (browser and node runtimes) and in the hub (one per class: relay, snapshot upload, non-critical
  index), *then* each appears in Sentry under the correct git-SHA release with distinct
  fingerprints.
- **A2** — *Given* the scrubber suite plus a manual spike, *when* any telemetry payload is
  inspected (errors, breadcrumbs, logs, events with synthetic page/workspace names and markdown
  planted in state), *then* zero payloads contain page content.
- **A3** — *Given* `SENTRY_DSN` unset, *when* the app runs (vitest with stubbed global fetch) and
  the hub runs, *then* the SDK is disabled and zero network telemetry is emitted (CI-enforced).
- **A4** — *Given* a staged app→hub round trip, *when* the sync call completes, *then* Better Stack
  holds structured log lines on both sides carrying the same correlation id, grep-able in one
  query.
- **A5** — *Given* staging, *when* each of the 3 baseline alerts and both uptime monitors is
  triggered once, *then* each delivers to the team channel.

## 7. Task sketch (PLAN will decompose, est points)

- T1r env placeholders + release tagging for Vercel **and** the hub (DevOps, est 1)
- T2n app SDK wiring + scrubber + Next-16/SDK compat check + tests A1/A2/A3 (Dev, est 2)
- T3n hub SDK wiring + fingerprint taxonomy per G3 (relay / critical persist / non-critical)
  A1/A4 (Dev, est 2)
- T4n Better Stack drain + browser log relay + uptime monitors + alerts + staging verify A5
  (DevOps, est 1)
- T5n QA gate: adversarial privacy spike A2/A3 regression suite (QA, est 1)

Build slices follow Red-Green-Refactor; each test requirement above is written first.
