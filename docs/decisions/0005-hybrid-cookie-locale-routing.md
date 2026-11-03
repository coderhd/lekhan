---
tags: [decision-log, i18n, routing, seo]
status: decided
---

# 0005 — Hybrid cookie/locale-subpath routing strategy for i18n

Linked: [[README]] · GitHub #31 · spec `docs/superpowers/specs/31-spec.md` · decided in the
[SIL-107](/SIL/issues/SIL-107) Spec & Planning Session (TL review record:
`docs/reviews/spec-31-tl-review.md`).

## Decision

Auth (`/login /signup /forgot-password`) and app-shell routes render per-locale **without URL
prefixes**, locale resolved server-side from cookie `lek-locale` (1y, SameSite=Lax, secure,
host-scoped, non-httpOnly; set via server action) with `en` fallback. Marketing pages gain locale
URL subpaths (`/hi/about`, `/zh/about`, …) via `app/[locale]/…` shared components; **`en` keeps its
unprefixed URLs** and is the canonical + `x-default` hreflang target. **No `proxy.ts`/`middleware.ts`
in H0**; `/api/*` is untouched and stays unlocalized.

## Context

- Private beta is live; link and email-flow churn is unacceptable; Supabase redirect flows must
  keep working.
- hreflang alternates require locale-addressable URLs (marketing only — app/auth are not
  crawlable surfaces worth alternate-tagging).
- This Next.js variant auto-deprecates `middleware.js` in favor of `proxy.js` (verified in
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`).
- H0 latency budgets (SIL-50) and zero-crash fallback (spec G3) must hold.

## Consequences

+ Zero live-link churn; no SEO regression (en canonicality preserved by construction).
+ No proxy → no new matcher to keep `/api/*` clean, no extra edge hop.
− First-visit non-English speakers land in `en` until they switch (accepted; cookie-only).
− Marketing needs `generateStaticParams` per locale; sitemap/robots/hreflang gain locale logic.
− User-profile locale field deferred to H1 (a server-side session-locale override becomes a
  profile field then, not a schema change now).

## Reversal triggers

- Analytics shows >5% meaningful first-visit locale mismatch → add `proxy.ts`-based
  `Accept-Language` negotiation (respecting the deprecated-convention rename).
- Any RTL locale enters the launch matrix → re-verify `dir` plumbing and any needed proxy.
