# Product

<!-- impeccable:product-schema 1 -->
<!-- Derived from owner-approved sources: .agents/product-marketing.md,
     docs/marketing/early-access-playbook.md, docs/marketing/founding-cohort-launch.md,
     docs/roadmap.md. Presented to owner for confirmation 2026-08-24. -->

## Platform

web

## Users

Primary: Obsidian users who want real-time collaboration and working AI without cloud lock-in or per-feature AI fees. Technical-adjacent, privacy-aware, allergic to marketing fluff. They already own their notes in markdown. Situation: evaluating whether to move their second brain to a new tool. Job: keep their files while gaining collaboration and AI.

Secondary (later waves): Notion refugees (after Notion import ships, H1); teams (H2, after databases).

## Product Purpose

Lekhan is a local-first collaborative knowledge workspace. Pages live as a graph (backlinks, tags, search), sync offline-first via CRDT, support real-time multiplayer editing, and every AI feature runs on the user's own keys or local models — never on our servers. Success: founding cohort (500 numbered spots) filled with users who stay; public launch ~Oct 12; $50k ARR via ~500 paying workspaces.

## Positioning

"Your second brain, your files, your AI. Local-first like Obsidian, collaborative like Notion — AI runs on your own keys." The mechanism a neighbor could not truthfully copy: notes live as files on the user's disk (architectural, not a checkbox) while real-time CRDT collaboration runs over them, and AI calls go browser-direct on user-supplied keys — never hosted, never pooled, never metered.

## Operating Context

Individuals and small teams evaluating PKM tools against Obsidian and Notion. Traffic arrives from build-in-public content (X, LinkedIn), Reddit threads (replies-only discipline), and referral links with ?ref attribution. Founding-cohort mechanics: invite-only, capped at 500, numbered spots, no fake scarcity. Beta invites roll in spot-number order from September 2026.

## Capabilities and Constraints

Shipped today: Obsidian vault import preserving wikilinks/callouts/frontmatter/tags; markdown round-trip export (.md/.mdx/.html/.pdf/.docx); real-time CRDT collaboration on shared pages; global search across the link graph; BYOK AI (OpenAI/Anthropic/Google keys, browser-direct); encrypted at rest by default (E2E tier in build, #81); founding waitlist with numbered spots (#85).

Constraints: no hosted AI inference ever (positioning bright line); no invented metrics or testimonials; interop ≤25% of any delivery horizon; Reddit is replies-only (account ban history).

## Brand Commitments

Name: Lekhan (Hindi: writing). Voice: plain, confident, specific; developer-respectful but not developer-only. Banned words: game-changer, revolutionary, seamless, supercharge, effortless, 10x. Humor dry, rare. Positioning line is binding everywhere. Colors: cream paper (#f9f8f4) + teak orange (hsl 33 100% 50%) + ink; Inter/Montserrat/Geist currently sitewide, Fraunces entered via /early. Dark mode is the site default.

## Evidence on Hand

Real, demonstrable: vault import with fidelity report; live multiplayer editing; export in five formats; BYOK settings flow. No testimonials, no customer counts, no benchmark numbers exist — future work must not fabricate any. Product screenshots exist in public/early/ (editor, import, share).

## Product Principles

1. Files stay files — leaving is an export button, not a migration project.
2. Keys stay yours — AI runs browser-direct on the user's provider keys or local models.
3. Honest scarcity and honest claims — real caps, real numbers, nothing invented.
4. Local-first is architectural, not a checkbox.
5. Developer-respectful plain speech over marketing gloss.

## Accessibility & Inclusion

Standard: WCAG AA contrast, visible keyboard focus, reduced-motion respected (already enforced on /early). Site dark mode is default and must remain first-class. Mobile 320–768px is a hard floor for public pages.
