# Implementation Plan — #31 H0 i18n Framework

- **Session**: [SIL-107](/SIL/issues/SIL-107) Spec & Planning (DEFINE + PLAN, 2026-10-27)
- **Spec**: `docs/superpowers/specs/31-spec.md` (rev 2, TL-APPROVED via
  [SIL-119](/SIL/issues/SIL-119)) · **ADR**: `docs/decisions/0005-hybrid-cookie-locale-routing.md`
- **Interface contract**: `docs/reviews/spec-31-tl-review.md` §A3 (catalog-shaped; Dev Engineer
  implements against it)
- **Budget**: 24h total (×0.9 next-intl calibration; review rounds included). Pinch: wave 3 —
  descope lever (editor deep surfaces English-only in H0) already consumed in spec §3.

## Wave 0 — Framework foundation (parallelize T2–T4 after the spike)

- [ ] **T2 — next-intl scaffold + T2n spike** (Dev Engineer, 2.5h)
  - Acceptance: `next-intl@^4.14` installed, cookie-mode (`without-i18n-routing`) config in
    place; spike renders one string from RSC (server `getTranslations`) and one from a client
    component (scoped provider) without error; `<html lang>` + `dir` (G7 heuristic) plumbed in
    the root layout; `npm run build` green.
  - Verify: `npm run build && npm run typecheck && npm test` on the spike commit; spike notes
    recorded in PR description (App Router `Link` locale behavior confirmed — no auto-prefix
    assumption).
  - Gate: **wave work is BLOCKED until this spike is green.** Fallback if red: in-repo
    dictionaries pattern (contract maps verbatim — see review record §A2).
- [ ] **T3 — catalog scaffolding** (Dev Engineer, 2.5h; depends T2)
  - Acceptance: `messages/{en,hi,zh,es,de}/{auth,marketing,settings,app-shell,editor-chrome}.json`
    skeletons; flat-key union type codegen from `en/*.json`; completeness + unused-key tests
    failing rightly (en key → missing in other locale = test red; unused locale key = test red)
    wired into `npm test`; prod fallback = `en` value, unknown locale → `en` pre-render.
  - Verify: `npm test` includes the i18n test file; positive + negative test cases added.
- [ ] **T4 — locale persistence seam** (Dev Engineer, 1.5h; depends T2)
  - Acceptance: first-party cookie `lek-locale` (SameSite=Lax, secure, host-scoped, 1y,
    non-httpOnly) read server-side in the root layout for pre-paint resolution; server action
    `setLocale` writes the cookie and re-renders; resolution chain cookie → profile (H1) →
    `Accept-Language`-only-if-proxy → `en`; `/api/*` untouched (zero route changes).
  - Verify: unit test for resolution chain; manual curl check that `/api/*` responses are
    unchanged.

## Wave 1 — Auth extraction (blocks on T2–T4)

- [ ] **T5 — auth routes extraction** (Dev Engineer, 2.5h)
  - Acceptance: `/login`, `/signup`, `/forgot-password` + shared auth chrome fully extracted
    into the `auth` namespace for all five locales; toast audit (N4) covers auth toasts; locale
    resolution works on auth pages without touching Supabase redirect flows; no beta-link
    behavior change (URLs unprefixed).
  - Verify: `npm test` + manual matrix run of the three routes in `hi` and `de`; existing auth
    flow can still complete (dogfood login once).

## Wave 2 — Marketing + settings chrome (parallelize T6 with T7/T8)

- [ ] **T6 — marketing subpaths + SEO** (Dev Engineer, 3h; depends T2–T4)
  - Acceptance: `/{locale}/about|faq|early|contact` via `app/[locale]/…` shared components;
    `en` unprefixed stays canonical + `x-default`; hreflang alternates emitted marketing-only;
    legal pages excluded from the alternate set (N1); sitemap/robots gain locale routes; catalog
    driven `generateMetadata({ params })` per page (N2); `generateStaticParams` single-sourced
    from the launch-matrix config (N3).
  - Verify: `npm run build` (static params compile); hreflang spot-check on `/hi/about` +
    `/about` `<link>` tags; Lighthouse no SEO regression on `/about`.
- [ ] **T7 — switcher UI** (Dev Engineer, 2h; depends T4; designer may amend baseline R5)
  - Acceptance: Settings language picker (≥ WCAG AA contrast), native language names (हिंदी,
    中文, Español, Deutsch), switch via `setLocale` server action, failure toast via client
    `t()`; persistence across reload verified (pre-hydration apply).
  - Verify: unit tests for the switch action + reload-persistence; axe/manual contrast check in
    both light/dark themes.
- [ ] **T8 — settings static chrome (5 tabs)** (Dev Engineer, 3h; depends T2–T4)
  - Acceptance: static settings copy across all 5 tabs extracted into the `settings` namespace;
    **billing callbacks (tier dialogs, callback toasts) explicitly deferred to T10**; toast
    callsites in settings audited (N4).
  - Verify: `npm test` + manual settings-tab sweep in `es` + `zh` (console clean, no fallback
    leaks in extracted strings).

## Wave 3 — App shell depth + translations (T9/T10 parallelizable with T11 start)

- [ ] **T9 — dashboard + top-level editor chrome** (Dev Engineer, 2.5h; depends T2–T4)
  - Acceptance: dashboard + editor top-level chrome extracted (`editor-chrome` namespace);
    editor deep surfaces (popovers/tool menus beyond top-level) **explicitly stay English** per
    spec §3; toast audit (N4).
  - Verify: `npm test` + dashboard dogfood in `hi`.
- [ ] **T10 — billing callbacks extraction** (Dev Engineer, 2h; depends T8 + #29 rail state —
  coordinate with the T6/T7 webhook owner [SIL-56](/SIL/issues/SIL-56))
  - Acceptance: tier-change dialogs + #29 callback toasts extracted for all locales; no changes
    to webhook payload semantics (only user-visible strings).
  - Verify: `npm test` on billing-UI tests; a tier-switch dogfood in the fake rail renders
    localized toasts.
- [ ] **T11 — translations + reviews** (PO-coordinated, 2.5h; depends catalogs of waves 1–3)
  - Acceptance: `hi` AI-draft + **native review pass** (quality bar); `zh/es/de` AI-drafts +
    native spot reviews; ICU plural syntax on count-bearing strings (N5); glossary enforced —
    brand terms untranslated, `CONTEXT.md` lexicon respected (spot-check the `vault`/`workspace`
    usage); translator glossary file checked in.
  - Verify: completeness tests green across all five locales; review notes recorded.

## Wave 4 — Close-out

- [ ] **T12 — audits + VERIFY + review** (Dev + QA, 1.5h)
  - Acceptance: wave-exit `t()`-adoption audits recorded per surface; client-bundle delta vs
    SIL-50 budgets checked; full verification green.
  - Verify: `npm run typecheck && npm run lint && npm test && npm run build`; clean-room review
    gate; QA matrix executed per the shift-left test plan.

## Verification & QA handoff

- Per-task verify commands above; final gate is the AGENTS.md suite:
  `npm run typecheck && npm run lint && npm test && npm run build`.
- QA shift-left test matrix ticket handed off from the SIL-107 session (rows sequenced per spec
  §8.2/B3: auth post-wave-1 → marketing post-wave-2 → settings + dashboard/editor post-wave-3).

## Risks

1. **Spike risk (T2n)** — closed pre-wave-1 by the 0.5h T2 gate; fallback contract maps 1:1.
2. **Live beta regression** — protected by no-proxy + unprefixed `en` URLs + auth-flow
   dogfoods per wave.
3. **Wave-3 pinch (T9/T10, 4.5h)** — descope lever consumed; if T10 must slip, it pairs with the
   #29 billing owner's schedule rather than blocking the launch matrix.
