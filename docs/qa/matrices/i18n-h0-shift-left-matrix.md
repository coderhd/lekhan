# QA Shift-Left Test Matrix — #31 H0 i18n Framework (A1–A5)

- **Spec**: `docs/superpowers/specs/31-spec.md` (rev 2, TL-APPROVED) · **ADR**:
  `docs/decisions/0005-hybrid-cookie-locale-routing.md` · **Plan**:
  `docs/superpowers/plans/2026-10-27-h0-i18n-framework.md` (T2–T12, 24h) · **TL contract**:
  `docs/reviews/spec-31-tl-review.md` §A3
- **Session**: [SIL-107](/SIL/issues/SIL-107) · **QA ticket**: SIL-120 · **Stack**: Next.js
  `^16.2.10` App Router (no `proxy.ts`/`middleware.ts` in H0), React `^19.2.7`,
  `next-intl@^4.14` cookie mode. Launch locales: `en` (source) + `hi, zh, es, de`.
- **Wave gating**: no wave-1 BUILD starts until the T2 spike gate (M0-1) is green. **This
  matrix's wave-exit review is the exit gate for every wave.** Adverse findings are logged to the
  session PO ([SIL-107](/SIL/issues/SIL-107)) and don't block a wave exit unless scope, live-beta
  behavior, or the full VERIFY suite is broken.
- **Translated-complete surface** (TL B3): all its user-visible strings extracted **and** all
  launch locales complete. Settings surfaces are translated-complete **only after wave 3**
  (billing callbacks extract in wave 3, paired with #29's rail on
  [SIL-56](/SIL/issues/SIL-56)).

**Row types** (each row = ticket-sized checklist entry):

| Tag | Type | Evidence |
|---|---|---|
| **AUT** | Automated | must be green in the wave-exit suite `npm run typecheck && npm run lint && npm test && npm run build` (or the named command) |
| **DOG** | Dogfood checkbox | manual browser run by named engineer, checkbox recorded on the wave PR/issue |
| **QA** | QA-run review | scripted manual QA pass; findings logged on this ticket's execution log |

---

## M0 — Wave-0 entry gates (T2–T4) — *must be green before wave-1 BUILD*

| # | Row | Verify | Type |
|---|---|---|---|
| M0-1 | **T2 spike green**: one RSC string (server `getTranslations`) + one client string (scoped `<NextIntlClientProvider>`) render without error | `npm run build && npm run typecheck && npm test` on spike commit; spike notes in PR description (incl. App Router `<Link>` **no auto-locale-prefix** confirmation) | AUT |
| M0-2 | `<html lang>` + `dir` (G7 heuristic, `ltr` for all launch locales) plumbed in root layout | spot-check rendered markup of spike renderer | AUT |
| M0-3 | Catalog scaffolding: `messages/{en,hi,zh,es,de}/` namespaces; completeness + unused-key tests wired into &nbsp;`npm test` **with positive + negative cases** | `npm test` includes `i18n` test file; deliberately missing key → red; deliberately unused key → red | AUT |
| M0-4 | Flat-key union type generated from `en/*.json` (codegen, not hand-rolled — TL review §A3); undeclared/renamed key is a **typecheck** error at the call-site | negative-case typecheck demo recorded once (red-light screenshot/log) | AUT |
| M0-5 | Cookie `lek-locale` (SameSite=Lax, secure, host-scoped, 1y, non-httpOnly) + resolution chain unit test (cookie → profile-H1 → Accept-Language-only-if-proxy → `en`) | unit test green; `curl` on 1–2 `/api/*` endpoints pre/post scaffold shows byte-identical responses | AUT |

---

## A1 — Locale × surface rows, sequenced per wave (spec §8.2 / B3)

### Wave 1 — auth funnel (T5; rows execute at wave-1 exit)

Surface scope: `/login`, `/signup`, `/forgot-password` + shared auth chrome.
Gate: M0-1..M0-5 green.

| # | Locale | Row | Verify | Type |
|---|---|---|---|---|
| A1-1 | hi | `/login` + `/signup` + `/forgot-password` render fully localized; `<html lang="hi">`; **zero console errors** on all three routes | browser pass, 3 routes in `hi` (per plan T5) | DOG |
| A1-2 | zh | same 3-route sweep as A1-1 | scripted browser pass | QA |
| A1-3 | es | same 3-route sweep as A1-1 | scripted browser pass | QA |
| A1-4 | de | same 3-route sweep as A1-1 | scripted browser pass | QA |
| A1-5 | — | **URLs stay unprefixed**: `/login` etc. still resolve with no `/en/…`/`/hi/…` rewrite; en canonical unchanged (no proxy inserted) | direct URL hits + view-source | DOG |
| A1-6 | — | **Auth flows still complete**: one full Supabase login round-trip (per locale spot: `hi` + `de`) lands on the app shell; redirect URLs unchanged | dogfood login once per plan T5 | DOG |
| A1-7 | — | **one auth toast localized** (e.g. wrong-password / rate-limit error) flowing through client `t()` with the `auth` namespace in provider scope (N4 first slice) | trigger the toast, verify copy is localized + console clean | DOG |

Wave-1 exit = matrix review of A1-1…A1-7 recorded in the execution log.

### Wave 2 — marketing + settings static chrome + switcher (T6–T8; excludes billing callbacks)

Gate: wave-1 exit recorded.

| # | Locale | Row | Verify | Type |
|---|---|---|---|---|
| A1-8 | hi | `/{locale}/about\|faq\|early\|contact` all render localized (×4 URLs); localized `<title>`/metadata via catalog-driven `generateMetadata` (N2); `<html lang="hi">`; **zero console errors** | scripted 4-URL pass | QA |
| A1-9 | zh · es · de | same 4-URL sweep (`/zh/about` etc.) | scripted 4-URL pass | QA |
| A1-10 | — | **hreflang alternates validate** on `/about`: `en` canonical + `x-default` → `/about` (en); alternates enumerate exactly the 4 prefixed locales + en; **legal pages (`/privacy-policy`, `/terms-of-service`) excluded** from the alternate set (N1); sitemap/robots carry locale routes | `npm run build` green; view-source `<link>` grep on `/about` + `/hi/about` | AUT + QA spot |
| A1-11 | — | **no SEO regression** on `/about`: Lighthouse SEO/canonical spot-check pre/post | Lighthouse run recorded | AUT |
| A1-12 | — | marketing pages statically renderable for every launch-matrix locale; `generateStaticParams` **single-sourced** from the launch-matrix config, not hand-enumerated (N3) | `npm run build` output shows static params for `/{locale}` segment | AUT |
| A1-13 | hi | **settings static chrome (5 tabs)** localized; *billing callbacks deliberately still English* (deferred to wave 3 — scope check, not a leak) | scripted 5-tab sweep in `es` + `zh` (plan T8) + `hi` | QA |
| A1-14 | — | **switcher UI**: language picker in Settings lists native names हिंदी / 中文 / Español / Deutsch; contrast **≥ WCAG AA** in light + dark themes | axe scan + manual contrast check (T7) | DOG + QA |
| A1-15 | — | **switch persistence**: pick हिंदी → reload → `hi` applied **pre-hydration** (no flash of English, zero hydration-mismatch console errors); cookie `lek-locale` attributes observable (Lax/secure/host-scoped/1y/non-httpOnly) | devtools + reload loop (T7) | DOG |
| A1-16 | — | **failed switch** surfaces a toast through client `t()` (N4 settings slice) | simulate failure (devtools block) → toast localized | DOG |

Wave-2 exit = matrix review of A1-8…A1-16.

### Wave 3 — dashboard + top-level editor chrome + billing callbacks + translation pass (T9–T11)

Gate: wave-2 exit recorded. Note: wave-3 completes tooltip/toasts paired with the #29 rail owner ([SIL-56](/SIL/issues/SIL-56)).

| # | Locale | Row | Verify | Type |
|---|---|---|---|---|
| A1-17 | hi | **dashboard** renders localized; zero console errors; no English leaks in migrated chrome | dashboard dogfood in `hi` (plan T9) | DOG |
| A1-18 | zh · es · de | same dashboard sweep | scripted pass | QA |
| A1-19 | hi (+zh spot) | **top-level editor chrome** localized; editor *deep surfaces* (popovers/tool menus, `components/editor/*`) **expectedly English-only** — §3 descope lever, not a defect — recorded as scope note | scripted pass + scope checklist | QA |
| A1-20 | — | **billing callbacks**: tier-change dialogs + #29 callback toasts localized (all launch locales); a fake-rail **tier-switch dogfood renders localized toasts**; webhook payloads unchanged | plan T10 verify | DOG + AUT |
| A1-21 | hi · zh | **ICU plurals**: count-bearing strings (pages/billing counts) render all plural cases — `hi` (1 page / 2 pages / 5 pages forms) + `zh` (no plural-distinction spot) (N5) | scripted render with 1/2/5 fixture data | QA |
| A1-22 | — | **`hi` native review pass** recorded before the public launch gate (§4 quality bar, §8.3) | signed-off native review notes on translator glossary/PR | QA review |
| A1-23 | — | **`zh/es/de` AI-draft + native spot review** notes recorded (T11) | spot-review notes | QA review |

Wave-3 exit = matrix review of A1-17…A1-23.

---

## A2 — Hygiene checks per locale (execute at **every** wave exit)

| # | Row | Verify | Type |
|---|---|---|---|
| A2-1 | `<html lang>` correct for the active locale on every migrated surface, incl. after a switch | render snapshot test + browser devtools spot | AUT + DOG |
| A2-2 | **unknown locale resolves to `en`**: unknown-locale URL (`/fr/about`) and cookie set to `fr` → en rendering, **no crash, no hydration mismatch** (G3) | scripted pass | AUT + DOG |
| A2-3 | **missing key → `en` fallback** (G3): delete a key in a non-en catalog → en value renders; dev warns / prod silent; completeness test goes red | negative case added to `npm test` | AUT |
| A2-4 | **`dir="ltr"` everywhere** in the launch set (G7 plumbing) | grep rendered HTML per locale | AUT |
| A2-5 | **no English leaks** in every *translated-complete* surface (full sweep only post-wave-3; per-wave scoped to migrated scope otherwise) | scripted visual/console sweep per locale; findings logged, non-blocking per wave gate | QA |

---

## A3 — Content-quality gates (N4 / N5 / glossary)

| # | Row | Verify | Type |
|---|---|---|---|
| A3-1 | **one `toast()` per migrated surface family localized**: auth (wave 1), switcher-failure + settings (wave 2), dashboard/editor-chrome + billing callbacks (wave 3); each flows through client `t()` with its namespace in the provider scope (N4, TL §A3) | per-wave callsite audit + one live toast per family (A1-7 / A1-16 / A1-20 rows serve as the family toast checks) | QA per wave |
| A3-2 | **ICU plurals on count-bearing strings**; `hi`/`zh` spot-check render (N5) | A1-21 | QA |
| A3-3 | **glossary enforcement** (TL §A3): brand terms `Lekhan`, `Free`, `Plus`, `Pro`, `Team` **untranslated** in every catalog; `vault` appears **only** in external-import strings; `workspace`/`page` lexicon per `CONTEXT.md` | consumer of `docs/qa` glossary spot-check over messages/ files + native/spot-review pass (T11); translator glossary file checked in | QA review |

---

## A4 — Structural gates (R6 / N3)

| # | Row | Verify | Type |
|---|---|---|---|
| A4-1 | **catalog completeness + unused-key tests present in `npm test`**; every shipped non-en locale ⊇ `en` keyset; unused keys fail; positive + negative cases exist (M0-3 evidence reused) | `npm test` | AUT |
| A4-2 | **typed keys are call-site-enforced**: a missing/renamed key is a **typecheck** error at the call-site (code generation from `en/*.json`, not hand-rolled) | negative typecheck demo | AUT |
| A4-3 | **add-a-locale = catalog + one launch-matrix config entry** (N3): dry-run fixture locale (e.g. `fr` in CI only, then removed) yields switcher listing, `generateStaticParams` entries, and hreflang alternates with **zero additional code edits** | fixture red-green build + QA review of the single config file | AUT build + QA review |
| A4-4 | **per-surface `t()`-adoption audit** (grep + human review) recorded at each wave exit (B4) | grep count + human sign-off note in wave PR | QA + AUT |

---

## A5 — Regression guard (live beta + budgets)

| # | Row | Verify | Type |
|---|---|---|---|
| A5-1 | **client bundle delta per rendered namespace** measured at wave-2 and wave-3 exit: only actually-rendered namespaces serialize in `<NextIntlClientProvider>`; delta recorded **vs the SIL-50 H0 latency budgets** | build output diff + bundle analyzer reading per wave, recorded in execution log | AUT |
| A5-2 | **`/api/*` responses byte-identical pre/post** i18n changes at every wave exit (sample: auth session + one settings read + one #29 billing-callback endpoint) | `curl` body/sha diff sampled per wave | AUT |
| A5-3 | full VERIFY suite green at every wave exit | `npm run typecheck && npm run lint && npm test && npm run build` | AUT |
| A5-4 | live-beta auth flow remains end-to-end intact (A1-6 dogfoods the funnel one wave additionally after wave-2 config changes) | dogfood login | DOG |

---

## Execution log (fill per wave-exit review)

| Wave | Gate | Rows reviewed | Result | Evidence |
|---|---|---|---|---|
| 0 (M0) | T2 spike | M0-1…M0-5 | ☐ | |
| 1 | wave-1 exit | A1-1…A1-7 | ☐ | |
| 2 | wave-2 exit | A1-8…A1-16 | ☐ | |
| 3 | wave-3 exit | A1-17…A1-23 | ☐ | |
| final | T12 full VERIFY | A2/A4/A5 full sweep | ☐ | |

## Traceability

| Matrix section | Spec anchor |
|---|---|
| A1 rows | §8.2, §5 R3/R4, B3, N2, N3, N4, N1 |
| A2 hygiene | G3, G7, §8.2 (zero console errors), §8.4 |
| A3 content quality | N4, N5, §4 quality bar/brand glossary, §8.6–8.7 |
| A4 structural | §8.1, §8.5, R6, B4, N3 |
| A5 regression | R2 bundle discipline, R4 `/api/*` untouched, ADR 0005 consequences |
