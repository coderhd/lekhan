# Session prompt: Start the H0 Ready backlog — import pipeline first

Date: 2026-08-14 · Status: current next-session prompt · Board: github.com/users/coderhd/projects/1

**Context.** The GitHub project "Lekhan" has five H0 epics in **Ready**: #26 Markdown
Import/Export, #27 Obsidian Importer, #28 AI Provider Registry, #29 Real Billing
(Stripe + Razorpay), #32 Docs Site — all `needs-spec`. The full product roadmap is in
`docs/roadmap.md` (epics #8–#55, H0–H3, native blocker edges). Strategy:
`docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md` (§6 AI, §7 billing,
§12 docs, §13 importers).

**Project board rule (applies all session):** every item moves
`Backlog → Ready → In progress → In review → Done` and the Status column is always
truthful — move an item with `bash docs/agents/project-board.sh <issue> <status>` at the
moment work actually starts, when review starts, and when it merges. Never leave a
`Ready` item being worked.

**Goal.** Turn the first Ready epic into a working feature: **#26 Markdown Import/Export
(full round-trip)**. It is the unblocked root of the import pipeline
(#26 → #27 Obsidian → #45 Notion importer), so it comes first.

**Do this in order:**

1. **Re-orient:** read `docs/roadmap.md`, strategy §13, §3 (pages as nodes), and the
   existing `tests/unit/markdown-paste.test.ts` + current export code (PDF/DOCX/HTML).
   Confirm epic #26's body and its blocker to #27.
2. **Move #26 to `In progress`** (`project-board.sh 26 "In progress"`) before starting.
3. **Spec it:** run the spec workflow on #26 — full round-trip contract (markdown → pages
   + `properties` + `[[links]]` + tags; pages → markdown), fidelity rules, edge cases
   (callouts, code fences, embeds, wikilink resolution). Publish the spec, flip #26
   `needs-spec` → `ready-for-agent`, break into tickets (`to-tickets`) with native blockers.
4. **Only after #26 is specced and ticketed**, do the same for **#27 Obsidian Importer**
   (rides the #26 pipeline) — move it to `In progress` only when its implementation begins.
5. **Stop for my review after each spec** — don't chain through billing/docs without a
   checkpoint. #28, #29, #32 stay `needs-spec` + Ready.

**Ground rules.** Follow `docs/agents/issue-tracker.md` (gh at `/opt/homebrew/bin/gh`,
native blockers, labels, board lifecycle). No code beyond the specced ticket work. Update
`docs/roadmap.md` if tracker state changes; it and `CONTEXT.md` are the session-continuity
anchors.
