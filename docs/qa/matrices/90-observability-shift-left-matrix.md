# QA Shift-Left Test Matrix — #90 H0 Observability Baseline (A1–A5)

- **Spec**: `docs/superpowers/specs/90-spec.md` (**rev 2, TL-APPROVED**, commit `5a89505` on
  `plan/29-real-billing`) · **TL contract**: `docs/reviews/spec-90-tl-review.md` (B1–B5 applied)
- **Epic**: [coderhd/lekhan#90](https://github.com/coderhd/lekhan/issues/90) · **QA ticket**: SIL-118
- **Gate**: per `docs/agents/sdlc-workflow.md` §3.2, no dev BUILD starts before this plan is posted.
- **Grounding**: rows below are written against repo reality, not spec claims — hub failure points
  read from `server/index.js` (upgrade-handler load-shedding 503 at L243–248, oversized-payload
  close-1009 at L328, bind-state download at L191, retention sweep warns at L401/L412, SIGTERM
  flush at L416–434, `/health` + `/metrics` HTTP handler serving `getServerMetrics`) and
  `server/persister.js` (storage upload at L39, legacy `documents` write, `nonCriticalResults`
  pattern at L59/L84–89). Test precedent: `tests/unit/sync-persister.test.ts` (mock adapters),
  `tests/unit/sync-server-health-metrics.test.ts`, `tests/unit/sarvam-scrub.test.ts` (repo-audit
  style). Stack: Next `^16.2.10`, vitest, single hub process (`npm run server`).

**Row types**:

| Tag | Type | Evidence |
|---|---|---|
| **AUT** | Automated | vitest test committed with the feature, green in `npm run typecheck && npm run lint && npm test && npm run build` |
| **STG** | Staged verify | one execution on staging (Sentry UI / Better Stack / team channel), link or screenshot recorded on the epic |
| **QA** | QA-run check | scripted manual pass by QA; findings logged on the epic thread |

**Canary convention** (shared by A2 rows): per-session reserved strings — page title
`CANARY-TITLE-<runid>`, workspace `CANARY-WS-<runid>`, markdown fragment `` ```CANARY-MD-<runid>``` ``
planted in document state. `<runid>` makes grep hits attributable to a single test execution.

---

## M0 — Entry gates (before any A-row executes)

| # | Row | Verify | Type |
|---|---|---|---|
| M0-1 | **Release tagging live on both targets** (T1r): one no-op deploy of the app (Vercel) and one hub restart/deploy both stamp `release` = git SHA | Sentry → Releases lists the SHA for app *and* hub projects; hub SHA visible even though no hub deploy config exists in-repo (T1r wires it wherever the hub ships) | STG |
| M0-2 | **Telemetry plumbing exists in staging**: Sentry projects (app, hub) receiving; Better Stack source connected; team-channel routing configured for alerts *and* monitors | one thrown test event lands in Sentry; one test log line lands in Better Stack source | STG |
| M0-3 | **Canary strings minted** for the session per the convention above | strings recorded in the execution log | QA |

---

## A1 — Staged seeded errors: correct release + distinct fingerprints (G3, spec §6-A1)

Failure classes per TL B1 taxonomy (rev 2): **relay** (upgrade-handler error / load-shedding
rejection / oversized payload), **critical persist** (snapshot upload / legacy DB write /
shutdown-flush / bind-state download), **non-critical** (graph-index, retention sweep, plan
lookup, version pruning — today `console.warn`-only).

| # | Row | Verify | Type |
|---|---|---|---|
| A1-1 | **Fingerprint taxonomy unit-tested**: each class maps to a distinct fingerprint array (`component + error-class`, *not* stack text, per spec §5 dedupe rule). Dev exposes a fingerprint helper; test asserts pairwise distinctness across relay / snapshot-upload / non-critical-index / retention / shutdown-flush / bind-state-download | vitest red-green on the helper; pairwise `expect(fp).not.toEqual(fp_other)` for all class pairs | AUT |
| A1-2 | **Non-critical failures are captured, not swallowed**: with mocked persister adapters (precedent `tests/unit/sync-persister.test.ts`), make `indexer.indexPage` reject, then each retention path (`pruneExpiredDocumentVersions` throw, plan-lookup failure, prune-result `false`) | `Sentry.captureException`/`captureMessage` called with **warning** level + that class's fingerprint; `persist` still returns `success: true`; `nonCriticalResults` reflects the failure (TL B1: errors-100% sampling applies to captures) | AUT |
| A1-3 | **Critical persist path fingerprints**: mock Storage `.upload` rejection (snapshot-upload class); legacy `documents` write rejection; shutdown-flush failure (SIGTERM handler with a rejected save) | captured with critical-persist fingerprints, distinct from A1-2's; shutdown-flush failure is *captured*, not only `console.error` (`server/index.js` L427 today) | AUT |
| A1-4 | **Browser runtime seeded error** (staging, DSNs set): dev-only self-test trigger (`captureException('A1-seed:browser')` behind a flag) | issue appears in Sentry **app** project; `release` == staging git SHA; fingerprint = browser class | STG |
| A1-5 | **Node runtime seeded error** (staging route handler) | issue in app project, node runtime source shown; `release` == same Vercel deployment SHA | STG |
| A1-6 | **Hub relay-class seeded failure** (staging hub): trigger one of — upgrade-handler error, load-shedding rejection (staging override of `MAX_CONNECTIONS` or heap pressure), oversized payload (`close 1009` path, `server/index.js` L328) | issue in **hub** project; `release` == hub git SHA (M0-1); fingerprint ≠ A1-7, A1-8 | STG |
| A1-7 | **Hub snapshot-upload seeded failure**: one staging run with hub Storage creds invalidated | Sentry issue with critical-persist fingerprint, distinct from relay (A1-6) and non-critical (A1-8) | STG |
| A1-8 | **Hub non-critical seeded failure**: break graph-index on staging for one save | Sentry issue at **warning** level, own fingerprint — proving the previously-silent `console.warn` class is now visible (the motivating gap, spec §1) | STG |
| A1-9 | **Fingerprint separation + dedupe audit**: all seeded issues A1-4…A1-8 pairwise-distinct groups; then repeat one relay failure 10× fast (restart-storm edge, spec §5) | Sentry UI shows no merged groups across classes, and the 10 repeats collapse into **one** group (fingerprint dedupe holds, quota protected) | QA |

---

## A2 — Privacy scrubber suite: zero page content in telemetry (G4 hard gate)

| # | Row | Verify | Type |
|---|---|---|---|
| A2-1 | **Scrubber unit test, canary-planted state**: Yjs binary update + markdown fragment in a text node, canary page title, canary workspace name, document URL, exception message, stack string, breadcrumb `data`, event `tags`/`extra` → run `beforeSend` + `beforeBreadcrumb` | serialized output of both scrubbers contains **zero** occurrences of any canary string (binary checked as UTF-8 lossy decode *and* byte-sequence) | AUT |
| A2-2 | **Adversarial variants**: (a) canary in fingerprint input — assert fingerprint derives from component+class tokens only; (b) canary in URL query (`?q=CANARY…`); (c) canary inside a Yjs-update handler's raw-binary `Error.message`; (d) canary in deeply-nested `extra` object; (e) canary as attachment-like blob field | every variant exits `beforeSend` clean or field-dropped-wholesale; **no deep traversal of document bodies** (content dropped, never filtered — spec §4 perf invariant) | AUT |
| A2-3 | **Egress sweep through the real pipeline**: seed canary state, point SDK at in-memory/stubbed transport, capture a genuine error event through init → transport (not by calling the scrubber directly) | outbound envelope body has zero canaries — catches "scrubber exists but init-wired wrong" order bugs | AUT |
| A2-4 | **Shared log-scrubbing helper** (app + hub): canary page title / workspace / markdown in structured log lines, incl. the Better Stack route-forwarder payload | helper output clean on both sides; forwarder carries no page content | AUT |
| A2-5 | **Manual spike** (spec §6-A2 "manual spike"): staging session edits a canary-titled page in a canary workspace with markdown planted, forces one error, then QA exports raw payloads (Sentry envelope via API; Better Stack source search) and greps for all canaries | zero hits across errors, breadcrumbs, logs, events; grep transcript recorded on the epic | QA |
| A2-6 | **Device-wide sweep (adversarial extension)**: repeat the A2-5 grep over the app's *other* telemetry sink, `posthog-js` capture payloads (existing dep; `tests/unit/analytics.test.ts` covers its events) | zero canaries — G4 says *zero page content ever leaves the device*, not just via Sentry; any hit is filed as `defect` of #90 (scope note: spec rev 2 §4 names Sentry scrubbers only; this row guards the invariant device-wide) | QA |

---

## A3 — Nil-DSN ⇒ SDK disabled, zero egress (CI-enforced)

| # | Row | Verify | Type |
|---|---|---|---|
| A3-1 | **App vitest, nil DSN**: unset `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN`; `vi.stubGlobal('fetch', stub)`; run init + raise one error + one log | `Sentry.isEnabled() === false` (or no client bound); **zero** fetch calls to any ingest URL; **zero buffering** (no offline-queue growth — TL adopted: nil-DSN means disabled, not buffering) | AUT |
| A3-2 | **Hub vitest, nil DSN**: same against the hub init (`@sentry/node`), synthetic relay + persist failure with DSN unset | SDK disabled, zero egress | AUT |
| A3-3 | **CI enforcement**: A3-1 + A3-2 are in the default `npm test` suite on CI | both run on every PR; flip one assertion to red once and record CI failing as gate-proof, then revert | AUT |
| A3-4 | **Local-dev spot**: run `npm run dev` and `npm run server` without env DSNs; devtools Network tab + hub stdout | zero Sentry ingest requests; zero telemetry-related crashes (covers AGPL forks / future self-host builds, spec §5) | QA |

---

## A4 — Correlation id round trip app→hub, grep-able in Better Stack (G2)

| # | Row | Verify | Type |
|---|---|---|---|
| A4-1 | **Mint + propagate unit test**: API-route forwarder mints/propagates `request_id`; hub connection handler mints `run_id` (`server/index.js` upgrade path); id propagates onto sync-call log lines as a structured JSON field (not only message text); id format validated (uuid) | vitest asserts mint, format, and propagation on both sides | AUT |
| A4-2 | **No token in the bundle**: repo-audit test (style of `tests/unit/sarvam-scrub.test.ts`) greps every client-reachable file/env for `BETTER_STACK_SOURCE_TOKEN`; browser log drains via the node-runtime route forwarder carrying the correlation id | audit test green; forwarder unit test asserts payload shape + id present, token absent | AUT |
| A4-3 | **Staging round trip**: one app→hub sync (edit page → persist snapshot); single Better Stack query for the id | hits on **both** app-side forwarder lines and hub-side connection/persist lines; same id; JSON-structured lines; saved query link recorded on the epic | STG |
| A4-4 | **Negative checks**: query for a synthetic non-existent id returns zero; pre-mint boot errors (no id yet) still pass scrubbing with zero page content | no accidental correlation via page/workspace names; scrubbing independent of id presence | QA |

---

## A5 — 3 baseline alerts + 2 uptime monitors deliver to the team channel (G5)

| # | Row | Verify | Type |
|---|---|---|---|
| A5-1 | **Alert 1 — new issue in app OR hub** | trigger one A1 seed → alert message lands in team channel | STG |
| A5-2 | **Alert 2 — sync-seam error rate > threshold in 5 min** | burst seeded hub sync-seam errors above threshold → alert lands | STG |
| A5-3 | **Alert 3 — p95 snapshot-upload latency breach** (BUILD gate G-2 first: span on the persist-upload step; threshold = SIL-50 number, recorded in spec §4) | staging: inject latency above the recorded budget → alert lands | STG |
| A5-4 | **Monitor 1 — hub uptime**: Better Stack monitor on hub `/health` — *QA note*: the hub already serves HTTP `/health` + `/metrics` returning **503 while shedding** (`getServerMetrics`, `server/index.js`), so an HTTP check gives shedding-aware downtime; TL B5 assumed ws-only. HTTP check adopted; TCP/ws is the fallback if the monitor can't reach the port over HTTP | stop staging hub once → down alert **and** recovery alert in team channel | STG |
| A5-5 | **Monitor 2 — app uptime**: monitor on the staging app URL (HTTPS 200); force one 5xx/pause window | alert + recovery land in team channel | STG |
| A5-6 | **Delivery audit**: each of the 5 delivered exactly once per trigger (no flap-duplicates), all routed to the G5 team channel, none to individual DMs; escalation policies remain a non-goal | checklist recorded on the epic | QA |

---

## G — BUILD-gate checks (green mid-BUILD, before A5 executes)

| # | Row | Verify | Type |
|---|---|---|---|
| G-1 | **`@sentry/nextjs` pin vs Next 16.2.10**: this repo's Next carries breaking changes (AGENTS.md); verify the pinned SDK version + instrumentation conventions (`instrumentation.ts` / `onRequestError`) against `node_modules/next/dist/docs/` (`01-app/03-api-reference`, upgrade guide) — *not* against training data | pinned version + verified conventions recorded in the epic PR; any pre-16-convention API flagged at review | QA |
| G-2 | **p95 measurement point exists**: span (or custom metric) wraps the persist-upload step (`PagePersister.persist` storage upload — background debounce save, not a routed transaction, so nothing to alert on otherwise, TL adopted) | H0 budget number pulled via the SIL-50 method and recorded in spec §4 **before** A5-3 runs | QA |
| G-3 | **Hub release tagging wired** (T1r): one staging hub deploy stamps `release` = git SHA | A1-6/7/8 release assertions are verifiable; recorded in Sentry releases | STG |
| G-4 | **Offline-transport decision recorded**: if the browser offline transport is unstable at the pinned SDK version → degrade to in-memory buffering; decision + evidence noted in spec §5 | spec updated before A-row staging runs | QA |
| G-5 | **Sampling matches spec**: errors 100% (captures included), traces 10% baseline, sync seam always traced via `tracesSampler`; browser config hardcodes `sendDefaultPii: false`; secrets (`BETTER_STACK_SOURCE_TOKEN`, auth keys) server-env only, browser DSN via `NEXT_PUBLIC_*` (TL B4 carve-out) | config review + assertions in A1-1/A4-2 tests | AUT |

---

## Traceability

| AC | Rows | Automated counterpart committed with code |
|---|---|---|
| A1 | A1-1…A1-9 | A1-1, A1-2, A1-3 (fingerprint helper + capture wiring) |
| A2 | A2-1…A2-6 | A2-1…A2-4 (scrubber, pipeline egress sweep, log helper) |
| A3 | A3-1…A3-4 | A3-1, A3-2, A3-3 (vitest, CI-enforced) |
| A4 | A4-1…A4-4 | A4-1, A4-2 (mint/propagate + no-token audit) |
| A5 | A5-1…A5-6 | — staged-only by nature (alert/monitor delivery); gates G-1…G-5 are QA-verified |

Per DoD §5 (`docs/agents/sdlc-workflow.md`), every AC carries a passing automated test committed
alongside the feature: the AUT rows above are that commitment; STG/QA rows are the staged
proofs that automation cannot provide (real Sentry ingest, Better Stack delivery, channel routing).

## Execution order & exit criteria

1. **M0** green (releases tagged, plumbing live, canaries minted).
2. Dev BUILD slices T2n/T3n/T4n write the AUT tests **first** (Red-Green-Refactor, spec §7);
   A1-1…A3-3 land committed with the code that satisfies them.
3. **G rows** green before the A5 staging run (G-1 gate is also a T2n acceptance item per TL).
4. Staged rows execute in dependency order: A1-4…A1-9 → A2-5/A2-6 → A4-3/A4-4 → A5-1…A5-6.
5. **Exit**: full VERIFY suite green (`npm run typecheck && npm run lint && npm test && npm run build`);
   every row checked with evidence linked on the epic; any red row filed as `defect` ("Defect of
   #90") and triaged per `docs/agents/triage-labels.md`; QA sign-off comment posted on the PR
   referencing this matrix. This matrix's execution log lives on
   [coderhd/lekhan#90](https://github.com/coderhd/lekhan/issues/90).
