# TL review record — spec #31 i18n framework (DEFINE rev 1 → rev 2)

Recorded verbatim from [SIL-119](/SIL/issues/SIL-119) (review child of the
[SIL-107](/SIL/issues/SIL-107) Spec & Planning Session), 2026-10-27. Reviewer: Tech Lead
(`tech-lead`). Verdict: **APPROVE-WITH-CHANGES**; all B1–B4 + N1–N5 applied in spec rev 2
(commit see `git log -- docs/superpowers/specs/31-spec.md`).

---

# TL review — `docs/superpowers/specs/31-spec.md` @ `52e9a1d` (DEFINE rev 1)

**Verdict: APPROVE-WITH-CHANGES.** The problem framing, scope discipline (§3 non-goals), locale
quality bar (§4), and the assignment of Q1–Q4 are all sound and reviewers agree on direction.
Rev 2 needed four substantive corrections (B1–B4 below), all TL/PO decisions resolved in this
comment — so rev 2 is an editing pass, not a re-think.

## A1 — Q1 routing/locale strategy decision (ADR core)

**Decision: hybrid — cookie-resolved rendering without URL prefixes for auth + app shell; locale
URL subpaths `/{locale}` (e.g. `/hi/about`) for marketing pages only; `en` keeps its current
unprefixed URLs as the canonical hreflang target. No `middleware.ts`/`proxy.ts` inserted in H0.**

Rationale, checked against the in-repo Next 16 docs (`node_modules/next/dist/docs/`):

1. **hreflang forces locale-addressable URLs** — `Accept-Language`/cookie negotiation alone
   cannot satisfy G6/§8.4 on marketing routes (no distinct URLs to alternate). The in-repo i18n
   guide (`01-app/02-guides/internationalization.md`) documents sub-path routing via the proxy
   file as the framework-supported structure.
2. **Live private-beta links must not churn** — every existing link (`/about`, `/login`,
   `/settings`, dashboard deep links, email links, indexed URLs) keeps working. So `en` stays
   unprefixed and is the canonical/x-default target — zero SEO regression by construction.
3. **App shell is not crawlable** — auth and app routes gain no SEO value from prefixed URLs;
   they localize via a cookie read server-side in the root layout. This avoids touching
   Supabase auth redirect flows that the beta depends on.
4. **Why no proxy insertion** — this Next variant **deprecates `middleware.js` and renames it
   `proxy.js`** (`middleware.md` frontmatter). Adding a locale proxy in H0 would buy a
   first-visit `Accept-Language` redirect and one more matcher to keep `/api/*` unlocalized —
   and a deprecated-convention risk surface. First-visit anonymous users default to `en` —
   acceptable for H0. Reversal trigger recorded in ADR 0005.
5. **In-repo doc gotcha**: the guide's `Link locale` auto-prepend behavior is documented with
   `pages/` examples — do **not** assume App Router `<Link>` auto-prefixes locale. Locale-subpath
   pages always `href` their full alternate URL explicitly. Verified in the T2 spike.

## A2 — Q2 mechanism decision: `next-intl` (cookie mode), with a pinned spike

**Decision: `next-intl@^4.14`** — latest `4.14.9` npm peer ranges verified against our
`next ^16.2.10` / `react ^19.2.7`. Config uses **without-i18n-routing (cookie) mode**, which
sidesteps the deprecated `middleware.ts` convention in next-intl's common docs snippets. A
**0.5h spike inside T2** (build the scaffold, render one RSC + one client string,
`npm run build`) closes the remaining `getRequestConfig`/async-request-APIs risk **before wave 1
extracts anything**.

**Fallback contract**: the in-repo i18n guide's first-party dictionaries pattern
(`getDictionary` + `app/[lang]` + `next/root-params`, typed by the en JSON). If the spike fails,
the interface contract below maps onto it verbatim — the contract is catalog-shaped, not
next-intl-shaped.

## A3 — Interface contract (Dev Engineer implements against this)

- **Catalog shape**: `messages/{en,hi,zh,es,de}/{auth,marketing,settings,app-shell,editor-chrome}.json`,
  namespaced per surface family. `en` is source of truth; every other locale's keyset ⊇ `en`.
- **Typing**: flat-key union generated from `en/*.json` (one codegen step in the completeness
  script; hand-rolled augmentation is not accepted). Keys typed for server `getTranslations()`
  and client (provider-scoped) `t()`.
- **Server (RSC)**: `getTranslations({ locale, namespace })` per surface — dictionaries loaded
  by dynamic `import()`, never shipped to the client; marketing pages stay statically
  renderable per-locale via `generateStaticParams` on the `/{locale}/marketing` segment.
- **Client**: `<NextIntlClientProvider messages={scopedSubset}>` — only the namespaces a client
  tree actually renders are serialized; bundle delta audited against the SIL-50 H0 latency
  budgets.
- **Fallback (G3)**: errors-on-missing disabled in prod; missing/unfinished key renders the `en`
  value (warn in dev, silent in prod); unknown locale resolves to `en` pre-render; `<html lang>`
  always emitted.
- **`dir` (G7)**: `dir = ['ar','he','fa','ur'].some(l => locale.startsWith(l)) ? 'rtl' : 'ltr'`
  on `<html>` in the root layout.
- **Lexicon enforcement**: translator glossary derives from `CONTEXT.md` — brand terms
  (`Lekhan`, `Free/Plus/Pro/Team`) never translated; `vault` only in external-import strings;
  glossary spot-check part of the `hi` QA row.
- **Toast integrity (N4)**: `components/ui/sonner` Toaster is a global client component — every
  toast string flows through client `t()` with its namespace in the provider scope; waves audit
  `toast(…)` callsites per surface.

## A4 — Q3 call + wave decomposition

**Q3: billing callbacks in the Settings suite → wave 3, not wave 2.** Billing-callback strings
surface from `@T6/#29` paths layered in the live billing rail; extracting amid rail-scoped flow
risks the beta. Static settings chrome (~90% of settings copy) stays wave 2. Consequence (B3): a
wave ships only when its catalog is complete; settings surfaces are translated-complete only
after wave 3.

## Findings

**B1** — §6 assumption 6 resolved by negation: no `middleware.ts`/`proxy.ts` in H0 (rationale in
A1; reversal triggers in ADR 0005). Rev 2 rewrote assumption 6.

**B2** — R4 persistence made concrete: `lek-locale` first-party cookie, `SameSite=Lax`, secure,
host-scoped, 1y, non-httpOnly; the switcher sets it via a **server action** (server-locale
re-render synchronously). User-profile locale field is explicitly H1 — avoids the spec's
"ask first" schema change.

**B3** — §8.2 QA matrix timing + surface-completeness semantics: "translated-complete surface"
= all user-visible strings extracted + all launch locales complete. Matrix rows sequenced:
auth post-wave-1, marketing post-wave-2, settings + dashboard/editor post-wave-3.

**B4** — R6/§8.1 enforcement formula: not implementable as a single noise-free ESLint rule.
Replaced by (a) test-based completeness/unused-key checks wired into `npm test`, (b) typed keys
making undeclared keys a typecheck error at call-sites, (c) per-surface `t()`-adoption audit at
wave exit.

**N1** — Legal pages stay English: hreflang alternates must exclude them, `x-default` → `en`;
current URLs preserved (no proxy) — automatic.

**N2** — Root-layout `metadata` is hardcoded English: wave 2 must add catalog-driven
`generateMetadata({ params })` for marketing pages (part of T5).

**N3** — `generateStaticParams` locale enumeration must be single-sourced from the same
launch-matrix config the switcher uses (§8.5's "one-line config" = this one file).

**N4** — Toast copy audit (see A3): every `toast()` callsite in migrated surfaces in scope for
waves 2/3; QA matrix includes one toast each.

**N5** — Pluralization: count-bearing strings use next-intl ICU plural syntax; `hi`/`zh`
reviews spot-check plural rendering.

## Hour-estimates (PLAN stage, 24h budget, ×0.9 next-intl calibration, review rounds included)

| # | Task | Wave | Est |
|---|---|---|---|
| T1 | Rev 2 spec edits (B1–B4, N1–N5 applied) + finalize ADR 0005 in repo | pre | 1h |
| T2 | next-intl install/cookie-mode config + T2n spike (RSC+client render, `build`) + `dir` and `<html lang>` plumbing | 0 | 2.5h |
| T3 | Catalog scaffolding: `messages/` namespaces, key-type codegen, completeness + unused-key test wired into `npm test`, fallback + provider scoping | 0 | 2.5h |
| T4 | Cookie persistence: `lek-locale` + server-action switching seam (switcher UI is T7) | 0 | 1.5h |
| T5 | Auth routes extraction (login, signup, forgot-password + shared auth chrome) + toast audit | 1 | 2.5h |
| T6 | Marketing: shared-component extraction + `/{locale}/about\|faq\|early\|contact` subpaths + hreflang/sitemap/robots + `generateMetadata` + static params | 2 | 3h |
| T7 | Switcher UI (incl. real-language-name list) + Settings integration + persistence/reload tests | 2 | 2h |
| T8 | Settings suite static chrome (5 tabs) | 2 | 3h |
| T9 | Dashboard + editor top-level chrome | 3 | 2.5h |
| T10 | Billing callbacks (tier dialogs, #29 callback toasts) — paired with #29 owner | 3 | 2h |
| T11 | `hi` native review pass + `zh/es/de` AI-draft + spot review + glossary enforcement | 3 | 2.5h |
| T12 | QA-matrix support + wave completeness audits + final VERIFY + review rounds | 4 | 1.5h |
| | **Total** | | **24h** |

Budget stress note: T9+T10 are the pinch points inside wave 3. Descope lever decided in rev 2 by
the PO: editor deep-surface labels (popovers/tool menus beyond top-level chrome,
`components/editor/*`) stay English-only for H0 — recorded in spec §3, not silently cut.

*— Define-reviewer TL, SIL-107 Spec & Planning Session.*
