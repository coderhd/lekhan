# Impeccable Critique Snapshot — Lekhan landing page (components/landing-page.tsx)

Date: 2026-08-24 · Provenance: dual isolated sub-agents (A: design review, B: detector/browser) + parallel technical audit (5 dimensions). No degradation.

## Scores

- Nielsen heuristics: **15/36** (poor band, 42%)
- Technical audit: **10/20** (a11y 2, perf 2, theming 2, responsive 2, integrity 2)
- Design specificity: **category-interchangeable** — an unrelated collab-editor could ship this page unchanged

## Convergent P0/P1 punch list (synthesized, deduplicated)

1. **[P0] Fake purchase confirmation** — logged-out visitors clicking plan CTAs get "Upgraded to Go plan successfully!" toast (components/pricing-plans.tsx:125-136); "Contact Sales" fakes a response. No auth, no checkout. The page lies about money to a trust-based audience.
2. **[P1] Page doesn't speak to its buyer** — zero mentions of Obsidian/markdown/vault/import/export/BYOK; binding positioning line absent; hero copy targets "high-performance teams" and calls the product "premium".
3. **[P1] Voice violations + fabricated proof** — "seamless(ly)" ×3 (landing-page.tsx:113,157,185, banned word); "THE FUTURE OF COLLABORATION"; "Join forward-thinking teams who have already upgraded" (implies nonexistent customers); "0ms Typing Latency" (invented metric, PRODUCT.md ban).
4. **[P1] Light-mode AA contrast failures** — orange text on cream 2.16:1; white-on-orange buttons 2.33:1; CTA slab 1.87:1 (dark mode passes everywhere).
5. **[P1] No mobile nav** — header links `hidden md:block`, no hamburger; /early unreachable from top of page on mobile; auto-hiding header removes Log In mid-scroll.
6. **[P1] Differentiation content absent** — no import story, no reversibility promise (5 export formats unmentioned), AI-trust story reduced to "+ BYOK"; no reassurance at commitment moments.
7. **[P1] SEO pair** — OG image 512×512 declared 1200×630; subpages' shallow-merged metadata wipes root OG image; /early missing from sitemap.
8. **[P1] Performance architecture** — marketing route `'use client'`, gated behind client-side auth check + GlobalLoader; Dashboard (668 lines) statically imported into marketing bundle; Material Symbols font loaded sitewide, unused on marketing pages.
9. **[P1] Token contract bugs** — `--on-primary-fixed(-variant)` consumed in light mode but defined only in `.dark`; `--primary` ≡ `--primary-container` in both themes (hover/gradient no-ops); legacy `#fca311` hardcoded in shared CSS.
10. **[P2 cluster]** — untaught jargon in pricing ("Sarvam AI Credits", "+ BYOK"); ₹-only pricing unlocalized; sub-44px touch targets throughout chrome; nested `<main>` landmarks; no skip link; reduced-motion not honored sitewide; triplicated page shells on about/faq/contact; robots trailing-slash; hero illustration light-styled on dark default; wordmark "L"-PNG + "ekhan" text hack.

## Strengths (genuine)

- Honest-scarcity line ("500 spots, price locked for life") — true cap, well-written, trapped in a sub-line
- Solid engineering floor: zero 320px overflow, no console errors, reserved-height pricing toggle, dark mode materially stronger than light
- Coherent persuasion skeleton: hero → steps → features → proof → pricing → CTA

## Emotional journey

Peak: hero. Valley 1: false "upgrade successful" toast = contaminated ending (peak-end in reverse). Valley 2: invented "0ms" stat adjacent to pricing poisons the money decision for a bullshit-detecting audience. Missing: reassurance at commitment (no "no credit card", "export anytime", "your keys never touch our servers").

## Provocative questions

1. If you deleted every sentence this page shares with every other AI-notes-app landing page, what would survive? (The founding-spot line — and nothing else. Why is the only true sentence the smallest?)
2. Would the author of PRODUCT.md's "plain speech over marketing gloss" recognize this page as theirs?
3. What if the hero said the true thing: "Your notes are already markdown files. Keep them. Add real-time collaboration and AI on your own keys."
4. Is any headline fix worth doing before the page stops lying about money?
