# 0005 — The engine is the single markdown seam; the transitional facades are deleted

Date: 2026-10-07
Status: Accepted
Applies to: import/export pipeline (`lib/markdown*`, `lib/import-hydration.ts`, `services/import.ts`, `services/obsidian-import.ts`); tracked by #115

## Context

PR #114 (#113) deepened `lib/markdown/engine.ts` into the one deep module — per-instance schema
caches, Page-only vocabulary, Mention + DOMParser internals — and left `lib/markdown-io.ts` and
`lib/yjs-seed.ts` as thin transitional wrappers delegating to the `markdownEngine` singleton.
#114's review left their exit plan as an explicit open question; this ADR closes it.

The two-names state is already drifting: `lib/markdown-export.ts` and `lib/import-hydration.ts` each
import some symbols from a facade and some from the engine inside the same file. The facades' own
headers say "New code should import from @/lib/markdown/engine directly" — that is a deprecation
notice, not an API posture. Their module identities (`markdown-io`, `yjs-seed`) are legacy names the
glossary has moved past (Page, Sidecar), and H3 Studio's decision
(`docs/decisions/h3-studio/03-generation-writes-pages-export-is-free.md`) depends on
engine-only serialize/parse — the interface Studio consumes is the engine, not the wrappers.

## Decision

**Delete both facades.** `@/lib/markdown/engine` is the public interface for parse/serialize,
frontmatter, Yjs seeding, and the base64 helpers: app code uses the `markdownEngine` singleton,
tests construct `new MarkdownEngine()` per test (the engine's own stated contract,
`lib/markdown/engine.ts:201`). No new wrapper module may be reintroduced around the engine.

The deletion test settles delete vs keep: removing the facades makes no complexity reappear at any
call site — every export is a one-line delegation. A wrapper that hides nothing is a naming tax, not
an API. "Keep as stable public API" was rejected: this is an app's `lib/`, not a published package
(no external consumers to stabilize for); nothing varies behind the seam (one adapter — a
hypothetical seam); and keeping would canonize the exact module identities `CONTEXT.md` retired.

**Milestone: execute now — not gated on #78 (the dual-dialect interop bridge / SIL-9).** The
migration is a behavior-preserving rename, while #78 will change semantics and possibly signatures;
renaming callers first leaves #78 one surface to change instead of maintaining shim signatures
through its window. #115's original suggestion post-dated #114's merge, when the engine interface
was still fluid — that premise no longer holds. Gating on an unscheduled, unassigned blocker is the
stall pattern that required the watchdog (SIL-47) to revive #115 in the first place.

## Consequences

- Caller migration lands as one BUILD child story under #115: 4 production files
  (`lib/import-hydration.ts`, `services/import.ts`, `services/obsidian-import.ts`,
  `lib/markdown-export.ts`), 5 test files (`tests/unit/{markdown-io,markdown-export,callout,yjs-seed,obsidian-import}.test.ts`
  — the facade-importing tests move to per-test `new MarkdownEngine()` instances), a stale comment
  fix at `lib/editor-extensions.ts:35`, and deletion of the two wrapper files.
- Done means: `typecheck && lint && test && build` green and zero `@/lib/markdown-io` /
  `@/lib/yjs-seed` imports remaining (grep-asserted at review).
- A future re-wrap needs a real seam — two adapters minimum (e.g., a server-side parser variant) —
  or a superseding ADR. Review should reject convenience files that rename engine methods back to
  the old module names.
- Historical documents (H0 specs, plans, research notes) keep the old names; they are dated records,
  not live interfaces.

Related: #113, #114, #115, ADR 0003, `docs/decisions/h3-studio/03-generation-writes-pages-export-is-free.md`
