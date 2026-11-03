# Spec — #31 H0 i18n Framework

- **Status**: DEFINE **rev 2** — TL-APPROVED (APPROVE-WITH-CHANGES) via [SIL-119](/SIL/issues/SIL-119)
  (findings B1–B4 + N1–N5 applied; review record: `docs/reviews/spec-31-tl-review.md`)
- **Epic**: [coderhd/lekhan#31](https://github.com/coderhd/lekhan/issues/31) · **Author**:
  Product Owner (`po-pm`, rev 1, 2026-10-27) · **Reviewer**: Tech Lead (`tech-lead`, rev 2,
  2026-10-27) · **Session**: [SIL-107](/SIL/issues/SIL-107) Spec & Planning
- **Companion artifacts**: ADR `docs/decisions/0005-hybrid-cookie-locale-routing.md` · PLAN
  `docs/superpowers/plans/2026-10-27-h0-i18n-framework.md` (T1–T12, 24h)
- **Invariants honored**: H0 launch rule — *nothing ships in H0 unless it is global-ready
  (i18n, billing, provider registry)* (strategy doc §10). `CONTEXT.md` language rules apply to
  every catalog string (workspace/page/tier lexicon; vault = external import only).

## 1. Problem

Lekhan is one localized-English UI today: every first-party string — auth screens, marketing
routes (`/about`, `/faq`, `/early`, `/contact`), the 5-tab settings suite, dashboard and editor
chrome — is hardcoded English. Private beta is live and the H0 public launch is quality-gated, and
global-readiness is a launch requirement, not a follow-up. Hindi at minimum is strategically
required (founding positioning; Indic wave cohort in SIL-96), but as *one feature of a generic
framework*, not product identity.

Today there is: no message-catalog system, no `middleware.ts`, no locale state, no intl deps
(verified: zero `.*intl.*|locale|translat.*` in `package.json`), and ~60 route/component surfaces
containing hardcoded copy.

## 2. Goals

G1. **Framework infra.** A single, typed i18n mechanism that works across Next.js 16.2.10 App
    Router, React 19 Server Components and client components, with type-checked keys and an
    English source-of-truth catalog.
G2. **Complete translation coverage of user-visible chrome.** Every first-party user-visible
    string in migrated surfaces renders through the mechanism — no hardcoded copy left in
    migrated surfaces (audit-enforced: per-surface `t()`-adoption audit at wave exit, §5 R6).
G3. **Zero-crash fallback.** A missing key, unfinished translation, or unknown locale never
    crashes rendering, never hydration-mismatches, and falls back to English source copy.
G4. **First locales.** Ship `en` (source) translated to **hi, zh, es, de** for all migrated H0 UI
    surfaces (scope: auth, marketing, settings static chrome, dashboard + top-level editor
    chrome; editor deep surfaces and legal pages excluded — §3); `hi` is held to native-review
    quality bar. Editor/page/user-authored content is never translated.
G5. **Locale switching.** The user can pick a language in Settings; the choice persists for the
    session/user and is honored on first paint (no flash of English on the app shell).
G6. **SEO correctness on public routes.** Marketing/pages become locale-aware with correct
    `hreflang` alternates and canonical URLs, and every publicly routed page is reachable in
    default `en` at least as well as today (no SEO regression).
G7. **RTL-tolerant plumbing.** Launch locales are all LTR, but the renderer plumbs `dir` from
    the active locale so a future RTL locale needs no component rewrites (cheap now, expensive
    later).

## 3. Non-goals

- **RTL locales** ship-critical support (G7 plumbing only; no RTL catalog in launch set).
- Hub-side (`server/index.js`) sync/relay message localization — server terminology stays English;
  the *app-side* render of sync errors localized via the client seam.
- Localized docs site content (docs follow i18n releases in H1, strategy §12).
- Localized legal pages (`/privacy-policy`, `/terms-of-service`): stay English with a header
  notice, pending legal review of translations.
- Per-workspace or shared team locale override (locale is a **user/device preference** in H0).
- Machine translation at render time.
- A/B localized pricing experiments (pricing string currency work already done in #29).
- **Editor deep surfaces** — popovers/context/tool menus beyond top-level editor chrome
  (`components/editor/*`): English-only in H0. Descope lever accepted in rev 2 (TL budget-stress
  note, [SIL-119](/SIL/issues/SIL-119)) to hold the 24h estimate; becomes a follow-up extraction
  wave post-launch.
- **User-profile locale field** — locale persists via the first-party cookie in H0; a
  profile/session-locale override is explicitly H1 (ADR 0005).

## 4. First locales & quality bar

| Locale | Scope | Quality bar |
|---|---|---|
| `en` | Source of truth | Native, all H0 surfaces |
| `hi` | All H0 surfaces | Native human review before ship (founding-positioning review bar) |
| `zh` | All H0 surfaces | AI-drafted + native spot review |
| `es` | All H0 surfaces | AI-drafted + native spot review |
| `de` | All H0 surfaces | AI-drafted + native spot review |

- Brand terms — **Lekhan, Tier names (Free/Plus/Pro/Team), Pro** — are not translated; they go
  into a protected glossary enforced at review time. Translator glossary derives from
  `CONTEXT.md` (workspace/page, import-side vault, edge, etc.).
- Possible follow-up locales (e.g. more Indic locales) must be an **add-a-catalog change**, not a
  code change.

## 5. Requirements (PO-contract for the TL/designer parts)

R1. **Mechanism choice** — **RESOLVED** by TL review: `next-intl@^4.14` in **cookie mode**
    (without-i18n-routing), peer-verified against `next ^16.2.10` / `react ^19.2.7`. The 0.5h T2
    spike (one RSC + one client string rendered, `npm run build` green) gates wave 1. The
    interface contract (TL, SIL-119) is written **catalog-shaped** so the fallback — the in-repo
    first-party dictionaries pattern (`app/[lang]` + `getDictionary`, typed from the en JSON) —
    maps on verbatim if the spike fails.
R2. **RSC/client split**: the mechanism must work without shipping all catalogs to the client
    bundle; catalogs split so hydration cost doesn't balloon (verify against H0 latency budgets
    audited in SIL-50).
R3. **Migration**: strings extraction happens in waves; wave boundaries are fixed by the TL
    review: **wave 1** auth routes → **wave 2** marketing (+ `generateMetadata`, hreflang) +
    settings static chrome + switcher UI → **wave 3** dashboard + top-level editor chrome +
    billing callbacks (tier dialogs / callback toasts, paired with #29 owner) → **wave 4** wave
    completeness audits + full VERIFY + review rounds. A wave ships only when its catalog is
    complete for every launch locale (B3).
R4. **Locale state** — resolved by ADR 0005: first-party cookie `lek-locale`
    (SameSite=Lax, secure, host-scoped, 1y, non-httpOnly), set by the switcher via a **server
    action** and read server-side in the root layout for pre-paint resolution (no flash).
    Resolution chain: cookie → user profile (H1) → `Accept-Language` (marketing only, only if a
    proxy is ever added) → `en`. `/api/*` untouched and unlocalized.
R5. **Switcher UX**: the designer mini-spec did not land in the session; a PO+TL baseline is
    recorded here and the designer may still amend during BUILD: language picker in Settings
    (≥ WCAG AA contrast), languages listed in their own language (हिंदी, 中文, Español, Deutsch),
    switch re-renders server-side via the cookie server action, a failed switch surfaces a toast
    through client `t()` (N4-scoped).
R6. **Catalog tooling** (reworked per B4 — an implementable gate, not a single ESLint rule):
    (a) catalog completeness + unused-key tests (every shipped locale ⊇ `en` keys; unused keys
    fail `npm test`); (b) flat-key union type generated from `en/*.json` — undeclared keys are a
    **typecheck** error at the call-site; (c) per-surface `t()`-adoption audit (grep + human
    review) in the wave-exit checklist.
R7. **Success-criteria reframing of "make the UI global-ready"**:
    - Migrated-surface audit: the `t()`-adoption audit at wave exit covers all user-visible
      strings — zero hardcoded first-party copy in migrated surfaces.
    - Switching locale anywhere in the web app re-renders fully localized, zero hydration errors
      in the console, and persists across reload.
    - Every locale in the launch set renders the auth funnel + settings + dashboard with no
      English fallback leaks in translated-complete surfaces.
    - `hreflang` alternates validate on the public marketing routes; legal pages are **excluded**
      from the alternate set with `x-default` → `en` (N1).
    - Adding a locale = one catalog directory + one entry in the **single launch-matrix config**
      that also drives `generateStaticParams` and the switcher (N3); adding a key updates `en`
      and the completeness tests cover it everywhere.

## 6. Assumptions (PO — correct me or they become ADR material)

1. Single web app today; no separate marketing-site deploy to localize.
2. **RESOLVED** (ADR 0005): locale preference lives with the user/device via the first-party
   `lek-locale` cookie (R4); profile-field override is H1.
3. The hub/CRDT sync layer needs no localization (English-only server log/status text).
4. Editor content, page titles, imported vault data are user content and never localized.
5. Launch locales are `hi, zh, es, de` beyond `en` (per epic #31 text).
6. **RESOLVED BY NEGATION** (B1): no `middleware.ts`/`proxy.ts` is inserted in H0 — this Next
   variant additionally deprecates `middleware` in favor of `proxy`, so any later insertion is a
   `proxy.ts` decision. Locale resolution is entirely server-side (cookie); `/api/*` stays
   unlocalized and untouched. Reversal triggers recorded in ADR 0005.

## 7. Decisions (resolved in the SIL-119 TL review)

- **Q1 → RESOLVED**: **hybrid routing** — cookie-resolved, unprefixed URLs for auth/app routes;
  locale URL subpaths (`/{locale}/…`, e.g. `/hi/about`) for marketing pages only; `en` keeps its
  unprefixed URLs as the canonical + `x-default` hreflang target; **no proxy/middleware in H0**.
  Core of ADR 0005.
- **Q2 → RESOLVED**: `next-intl ^4.14` (peer-verified), cookie mode; T2n spike (0.5h, inside T2)
  closes the remaining async-request-APIs risk; fallback contract = in-repo dictionaries pattern
  (see R1).
- **Q3 → RESOLVED**: settings billing callbacks → **wave 3**, not wave 2 (see R3/B3).
- **Q4 → designer did not respond in the session**; the switcher baseline in R5 is recorded as
  the working mini-spec, amendable during BUILD.
- **Q5 → resolved in advance** (unchanged): billing webhook payloads are not translated;
  user-visible toasts from #29 callback code are in scope (wave 3, N4).

## 8. Success criteria

1. `npm test` gate includes catalog completeness + unused-key checks for the launch matrix;
   typed keys make an undeclared/renamed key a **typecheck** error at the call-site (R6).
2. The manual QA matrix (QA shift-left ticket created with this spec) enumerates, per launch
   locale: **auth funnel post-wave-1**, **marketing pages post-wave-2** (incl. localized
   `<title>`/metadata via `generateMetadata`, hreflang/x-default alternates, legal pages excluded
   from the alternate set), **settings static chrome + dashboard + top-level editor chrome
   post-wave-3** — each row localizes with zero console errors. A **translated-complete surface**
   = all its user-visible strings extracted + all launch locales complete (B3).
3. `hi` surfaces reviewed natively at least once before the public launch gate.
4. Locale switch across browser reload persists and re-applies pre-hydration.
5. A new locale is enabled by adding a catalog directory + one launch-matrix config entry
   (single source driving the switcher, `generateStaticParams`, and the hreflang set), passing
   CI (N3).
6. Every `toast()` callsite in migrated surfaces flows through client `t()` with its namespace
   in the provider scope; the QA matrix includes one toast per migrated surface family (N4).
7. Count-bearing strings (pages/billing counts) use ICU plural syntax; `hi`/`zh` native/spot
   reviews include a plural-rendering check (N5).

## 9. Estimate

- Roadmap estimate: **24h** — confirmed by the TL hour table (T1–T12 in the PLAN; ×0.9
  next-intl calibration; review rounds included). Pinch point: wave 3 (T9 dashboard/editor +
  T10 billing callbacks); the descope lever (editor deep surfaces → §3) is consumed to hold the
  budget.

## 10. Boundaries

- **Always**: honor `CONTEXT.md` lexicon in catalog strings; non-`en` catalogs ⊇ `en` keyset
  before a surface is called translated-complete; verify against the in-repo Next.js docs before
  hard-coding any new Next behavior assumptions.
- **Ask first**: any deviation from the ADR 0005 approach (inserting `proxy.ts`, a profile-field
  locale override in H0, or switching mechanisms without the fallback being the dictionaries
  pattern); i18n dependency pins beyond `next-intl@^4.14` as configured in T2.
- **Never**: ship a half-translated locale unflagged — all five launch locales (`en` + 4) render
  for a shipped surface or that locale stays out of the public switcher.
