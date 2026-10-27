# Spec — #31 H0 i18n Framework

- **Status**: DEFINE **rev 1** — PO draft, in review with Tech Lead + UI/UX Designer via the
  SIL-107 Spec & Planning Session (2026-10-27)
- **Epic**: [coderhd/lekhan#31](https://github.com/coderhd/lekhan/issues/31) · **Author**:
  Product Owner (`po-pm`, rev 1, 2026-10-27)
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
    migrated surfaces (lint-enforced).
G3. **Zero-crash fallback.** A missing key, unfinished translation, or unknown locale never
    crashes rendering, never hydration-mismatches, and falls back to English source copy.
G4. **First locales.** Ship `en` (source) translated to **hi, zh, es, de** for all H0 surfaces;
    `hi` is held to native-review quality bar. Editor/page/user-authored content is never
    translated.
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

R1. **Mechanism choice** is Tech Lead-owned (interface contract + ADR). The strategy doc names
    `next-intl or similar`; the TL's contract review must confirm compatibility with **Next.js
    16.2.10** and React 19 (verify against `node_modules/next/dist/docs/` — T2n-style gate, same
    as the #90 spec did for the Sentry SDK).
R2. **RSC/client split**: the mechanism must work without shipping all catalogs to the client
    bundle; catalogs split so hydration cost doesn't balloon (verify against H0 latency budgets
    audited in SIL-50).
R3. **Migration**: strings extraction happens in waves so no wave breaks the merged tree —
    wave order and slice boundaries proposed in the PLAN (suggested order: auth routes →
    marketing routes → settings suite → dashboard/editor chrome).
R4. **Locale state**: selected locale is a user preference, resolved at the server before paint;
    persistence mechanism = TL decision (ADR-covered).
R5. **Switcher UX**: designer-owned mini-spec (language picker in Settings ≥ WCAG contrast, real
    translated labels for each language in its own language in the list, e.g. हिंदी, 中文,
    Español, Deutsch).
R6. **Catalog tooling**: a completeness check (all shipped locales ⊇ en keys, unused keys fail
    lint) wired into `npm run lint`/`test` so drift is caught at PR time.
R7. **Success-criteria reframing of "make the UI global-ready"**:
    - `grep`-able: zero hardcoded first-party copy in migrated surfaces (lint rule passes).
    - Switching locale anywhere in the web app re-renders fully localized, zero hydration errors
      in the console, and persists across reload.
    - Every locale in the launch set renders the auth funnel + settings + dashboard with no
      English fallback leaks in translated-complete surfaces.
    - `hreflang` alternates validate on the public marketing routes.
    - Adding a locale = adding one catalog directory; adding a key updates `en` and lints the
      other five.

## 6. Assumptions (PO — correct me or they become ADR material)

1. Single web app today; no separate marketing-site deploy to localize.
2. Locale preference lives with the user (cookie/localStorage/profile), not per-workspace.
3. The hub/CRDT sync layer needs no localization (English-only server log/status text).
4. Editor content, page titles, imported vault data are user content and never localized.
5. Launch locales are `hi, zh, es, de` beyond `en` (per epic #31 text).
6. No `middleware.ts` exists today — locale resolution must be added thoughtfully to not break
   the sync/API routes (`/api/*` stays unlocalized).

## 7. Open questions (assigned)

- **Q1 → Tech Lead**: routing strategy — locale subpaths (`/en/...`) vs cookie+header negotiation
  without prefixes for the app shell; consequences for the beta's live links and for API routes.
  This is the ADR core.
- **Q2 → Tech Lead**: next-intl vs. a minimal custom `getMessages()`/`t()` contract that is
  framework-compatible with Next 16 behavior changes (vendor note: Next is *not* stock 16 —
  check `node_modules/next/dist/docs/` survey for locale-related breaking changes).
- **Q3 → Tech Lead**: are settings' tier-change dialogs (billing callbacks) part of wave 2 or
  wave 3 (est. impact on the 24h budget)?
- **Q4 → Designer**: switcher placement/forms, real-name language list, loading state during
  switch, error toast copy for a failed switch.
- **Q5 → PO (resolved in advance)**: pricing pulses and the definition of Tier names are not in
  scope to translate the strings inside billing webhook payloads — any burst-server messages
  shown in TOASTS rendered from @T6/#29 callback code *are* in scope if they surface to users.

## 8. Success criteria

1. `npm run lint` gate includes the i18n completeness checks for locales in the launch matrix.
2. A manual QA matrix (QA shift-left ticket once DEFINE rev 2 is approved) can enumerate: for
   each launch locale × (auth route + dashboard + settings tab + one marketing page) the surface
   renders localized with zero console errors.
3. `hi` surfaces reviewed natively at least once before the public launch gate.
4. Locale switch across browser reload persists and re-applies pre-hydration.
5. A new locale can be enabled via catalog + one-line config, passing CI.

## 9. Estimate

- Roadmap estimate: **24h** (H0 P0). TL owns the decomposition against this budget in the PLAN;
  review-round tax included per calibration policy (novel-framework integration ×1.5 rule is
  likely *not* needed since next-intl is a familiar pattern).

## 10. Boundaries

- **Always**: honor `CONTEXT.md` lexicon in catalog strings; English source keys complete before
  a locale adds keys; verify against the in-repo Next.js docs before hard-coding any new Next
  behavior assumptions.
- **Ask first**: schema changes to store a persisted user locale profile field; adding i18n
  dependencies chosen by the TL outside the ADR summary in this spec.
- **Never**: ship a half-translated locale behind no feature flag — either all six launch
  locales render for shipped surfaces or a locale is withheld from the public switcher.
