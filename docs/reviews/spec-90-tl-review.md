# TL Review: Spec #90 — H0 Observability baseline (Sentry app + sync server + Better Stack)

- **Reviewed**: `docs/superpowers/specs/90-spec.md` rev 1 (PO draft, 2026-10-27)
- **Reviewer**: Tech Lead · **Review issue**: [SIL-110](/SIL/issues/SIL-110) · **Epic**: [coderhd/lekhan#90](https://github.com/coderhd/lekhan/issues/90)
- **Date**: 2026-10-27
- **Verdict**: **APPROVED as rev 2** — blocking findings B1–B5 applied by TL directly into the spec doc (docs are TL-writable per `docs/agents/sdlc-workflow.md` §2); app code untouched.

## Grounding method

Every finding below was checked against repo reality, not the spec's claims: `CONTEXT.md`;
ADR 0001 (encryption at rest), 0002 (retention), 0003 (desktop/sidecar), 0004 (hub CRDT
topology); code read of `server/index.js`, `server/persister.js` (serialized saves, persister
error boundaries, retention sweep); repo greps confirming: zero existing telemetry
(greenfield), Next.js **16.2.10**, no hub deploy config (no Procfile/fly.toml/railway.json/
Dockerfile), **no `server/wal.js`**, no worker processes, no instrumentation file yet.

## Findings

### B1 — G3 taxonomy references a removed component (BLOCKING — fixed in rev 2)

Rev 1 names "WAL replay error" as a sync-seam failure state with its own fingerprint. But
`server/wal.js` no longer exists: ADR 0003 cites it ("already implements the append-updates +
compacted-snapshot pattern"), yet the hub persistence collapse (see
`docs/reviews/pr-hub-persister-review.md`) replaced the WAL pattern with
`PagePersister.persist` + serialized saves (`triggerSerializedSave` in `server/index.js`).
The desktop-side WAL (`.lekhan/` sidecar) is H1 Tauri scope (epic #43). BUILD would have wired
a fingerprint for a component that cannot fail because it is gone.

Rev 2 replaces the G3 taxonomy with the hub's **real** failure states, read from
`server/index.js` / `persister.js`:

- **Relay**: upgrade-handler error; load-shedding connection rejection (`MAX_CONNECTIONS` /
  memory exhaustion guard); oversized-payload rejection.
- **Critical persist path**: snapshot upload failure to Supabase Storage; legacy `documents`
  DB write failure; shutdown-flush save failures; bind-state download failure
  (`main_state.bin` fetch on reconnect).
- **Non-critical, currently silent** (`console.warn` only, per the persister's
  `nonCriticalResults` pattern): graph-index indexing failure, retention sweep error,
  retention plan-lookup failure, persister version-pruning failure.

The non-critical class matters most: these are the exact silent failures that motivated the
spec. Rev 2 requires them captured as Sentry issues at `warning` level with their own
fingerprints — errors 100% sampling applies to captures, not only to throws. A1's "distinct
fingerprints" now means relay-drop ≠ snapshot-upload ≠ non-critical index/retention.

### B2 — "BYOK tier / self-hosted mode" does not exist (BLOCKING — fixed in rev 2)

Rev 1's edge case "BYOK tier: DSN env omitted entirely in self-hosted mode" conflates two
unrelated concepts. BYOK is an AI access mode (user-held provider keys) per `CONTEXT.md`
Access & AI, not a tier; Lekhan H0 is cloud-hosted (Vercel app + Supabase + hub server) with
no self-hosted distribution (the only "self-hosted" hit in docs is the #85 waitlist's
self-hosted double-opt-in over Brevo). Rev 2 restates the actual invariant:
`SENTRY_DSN` unset ⇒ SDK fully disabled, zero egress — which covers local dev, AGPL forks,
and any future self-host build, and is exactly what A3 tests.

### B3 — The hub is one process, not "workers" (BLOCKING — fixed in rev 2)

Rev 1 says "sync server worker backend" and "snapshot workers". Reality: `npm run server`
runs `server/index.js` as a **single Node process** containing the y-websocket relay, the
debounced serialized persister, and the retention sweep timer. There are no workers to
instrument separately. Rev 2: `@sentry/node` initializes once in the hub process and covers
relay + persister + sweep; `@sentry/opentelemetry-node` remains a BUILD decision only if
request-level relay traces are wanted.

### B4 — Telemetry egress contradictions (BLOCKING — fixed in rev 2)

1. "DSN & keys: server-side env only" contradicts the browser DSN: a browser ingest DSN must
   ship in the client bundle (`NEXT_PUBLIC_*`). A DSN is a public-by-design ingest
   identifier, not a secret. Rev 2 keeps only *tokens* server-side (Better Stack source
   token, any auth keys), states the browser-DSN carve-out explicitly, and keeps
   `sendDefaultPii: false` hardcoded in the browser config.
2. G2/A4 define no browser→Better Stack path, yet the Better Stack source token must never
   reach the bundle. Rev 2: browser structured logs drain via the Next.js node runtime (a
   route-handler forwarder); the correlation id (`request_id` / `run_id`) is minted at entry
   points (API route / hub connection) and propagated on sync calls — that is the A4
   grep-able app→server round trip.

### B5 — Scope gap vs epic title: uptime monitoring (ADOPTED — PO may veto)

Epic #90's title: "Sentry (app + sync server) + Better Stack (**uptime, logs, status
page**)". Rev 1's goals omit uptime entirely — a beta where the hub silently goes down
re-creates the exact "support DMs" problem the spec exists to kill. Rev 2 adds: Better Stack
uptime monitor on the hub (TCP/ws reachability; an HTTP health endpoint only if one is added
— the relay is ws-only today) and on the app URL, alerting through the same G5 team-channel
routing. **Public status page stays a non-goal for beta** (public comms commitment is
marketing-owned; revisit post-beta). PO can pull the status page in later — it is a Better
Stack toggle, not new architecture.

## Adopted (non-blocking)

- **ACs as Given/When/Then** — Definition of Ready (`docs/agents/sdlc-workflow.md` §4)
  requires G/W/T before the QA shift-left gate; rev 2 converts A1–A5.
- **Alert 3 measurement point** — p95 snapshot-upload latency is a background debounce save,
  not a routed transaction, so Sentry has nothing to alert on unless BUILD wraps the upload
  step in a span (or custom metric) and alerts on that. Rev 2 states this. The H0 budget
  number is pulled from the SIL-50 method and recorded in the spec at BUILD.
- **A3 mechanism pinned** — vitest with a stubbed global fetch asserting zero telemetry
  egress + SDK-disabled under nil DSN. No e2e/Playwright infra exists; introducing it for
  this is new scope H0 doesn't need.
- **Offline buffering tightened** — the 7-day drop-oldest buffer applies only when a DSN is
  set but the network is down; nil-DSN means fully disabled (no buffering, no egress).
  Browser offline transport is experimental in current Sentry SDKs — if unstable at the
  pinned version, H0 degrades to in-memory buffering only, and BUILD records that decision
  in the spec.
- **Release hygiene covers the hub, not just Vercel** — no hub deploy pipeline config exists
  in-repo; T1r must wire hub release tagging (git SHA) wherever the hub ships, else A1's
  "correct release tag" is unverifiable for hub-side errors.
- **Next 16.2.10 compat check** — `@sentry/nextjs` version pin and Next-16 instrumentation
  conventions must be verified against `node_modules/next/dist/docs/` at BUILD (a T2n
  acceptance item; this repo's Next version carries breaking changes per AGENTS.md).
- **Language + copy** — "note content" → "page content" (CONTEXT.md avoid-list); garbled
  non-goal bullet ("Appself-hosted offline mode…") rewritten; "release-re", "clean-shaven"
  fixed.
- **Scrubber performance** — `beforeSend` scrubbing runs on the editor main thread; rev 2
  notes the scrubber is O(payload) with no deep traversal of document bodies (content is
  dropped wholesale, not filtered), keeping the "never block the editor main thread"
  invariant realistic.

## Verdict & handoff

**APPROVED as rev 2.** The spec is now plan-ready. Next gates per
`docs/agents/sdlc-workflow.md` §3.2: QA posts the shift-left test plan (A1–A5 rev 2) before
dev writes any code; PLAN decomposes §7 after. B5 (uptime in / status page out) is the one
PO-vetoable call — flagged on the epic for a speaking objection, silence = adopt.
