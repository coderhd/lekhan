# SIL-54 BUILD — retire markdown facades (ADR 0005)

Branch: `feat/54-retire-markdown-facades` (base `origin/main` @ `38d80ee`).
Source plan: coderhd/lekhan#122. Decision: `docs/adr/0005-engine-is-the-single-markdown-seam-facades-deleted.md`.

## Goal
`lib/markdown/engine.ts` is the sole public seam for page markdown. Delete the
`lib/markdown-io.ts` and `lib/yjs-seed.ts` facades after migrating every caller.
Pure behavior-preserving rename — no test expectation may change.

## Slices (atomic, each ends green)

- [x] **Slice 0 — characterization net.** Engine surface used by today's facade
      callers covered through per-test `new MarkdownEngine()` instances. This is
      a pure rename, so the net passes immediately by design (characterization,
      not new behavior); the red moment is the deletion in Slice 3, where any
      un-migrated facade import breaks typecheck.
- [x] **Slice 1 — tests cross the seam.**
  - [ ] `tests/unit/callout.test.ts`, `tests/unit/markdown-export.test.ts`,
        `tests/unit/obsidian-import.test.ts`: import-path switch only, assertions
        unchanged.
  - [ ] Fold `tests/unit/markdown-io.test.ts` + `tests/unit/yjs-seed.test.ts`
        into `tests/unit/markdown-engine.test.ts` (per-test instances) and delete
        the two facade test files.
- [x] **Slice 2 — production callers:** `lib/import-hydration.ts`,
      `services/import.ts`, `services/obsidian-import.ts`, `lib/markdown-export.ts`.
- [x] **Slice 3 — deletion:** delete both facades; fix stale comment at
      `lib/editor-extensions.ts:35`; grep-assert zero `@/lib/markdown-io` /
      `@/lib/yjs-seed` imports; full verify; clean-room review.

## Symbol mapping (from #122)
| Facade | Engine |
|---|---|
| `parseMarkdown(md)` | `markdownEngine.parse(md)` |
| `serializeMarkdown(doc, exts?)` | `markdownEngine.serialize(doc, exts?)` |
| `parseFrontmatter(md)` | `markdownEngine.parseFrontmatter(md)` |
| `buildFrontmatter(meta)` | `markdownEngine.buildFrontmatter(meta)` |
| `assembleMarkdownFile(meta, body)` | `markdownEngine.assembleMarkdownFile(meta, body)` |
| `contentToYjsBase64(json)` | `markdownEngine.seedToYjsBase64(json)` |
| `contentToPlainText(json)` | `markdownEngine.plainText(json)` |
| `uint8ArrayToBase64` / `base64ToUint8Array` | same names, top-level engine exports |
| `PageMeta` / `ParsedFrontmatter` | from `@/lib/markdown/engine` |

## Verify log
- Baseline (origin/main): 6 files / 114 tests green.
- Slice 1: `markdown-engine.test.ts` 50 tests green (9 original + 41 migrated;
  markdown-io 34 + yjs-seed 7 = 41, zero assertions dropped).
- Slice 2: `tsc --noEmit` clean; 9 dependent suites / 145 tests green.
- Slice 3 (Stage 4 VERIFY, branch `feat/54-retire-markdown-facades`):
  - `npm run typecheck` → exit 0
  - `npm run lint` → exit 0 (one pre-existing dead-local in
    `scripts/paperclip/assign-execution-gates.mjs` from #120 removed to unblock
    the gate; separate commit)
  - `npm test` → 78 files / 574 tests passed (exit 0)
  - `npm run build` → exit 0 (Next 16 / Turbopack, 23 routes)
- Grep-assert: zero `@/lib/markdown-io` / `@/lib/yjs-seed` imports in
  `lib/ services/ components/ app/ tests/`; both facade files deleted.

## Commit graph (base `38d80ee`)
1. `test(markdown): migrate facade tests to per-test MarkdownEngine instances`
2. `refactor(markdown): migrate production callers to lib/markdown/engine`
3. `refactor(markdown): delete markdown-io + yjs-seed facades (ADR 0005)`
4. `fix(scripts): drop dead local in assign-execution-gates (pre-existing lint)`
