# SIL-54 BUILD — retire markdown facades (ADR 0005)

Branch: `feat/54-retire-markdown-facades` (base `origin/main` @ `38d80ee`).
Source plan: coderhd/lekhan#122. Decision: `docs/adr/0005-engine-is-the-single-markdown-seam-facades-deleted.md`.

## Goal
`lib/markdown/engine.ts` is the sole public seam for page markdown. Delete the
`lib/markdown-io.ts` and `lib/yjs-seed.ts` facades after migrating every caller.
Pure behavior-preserving rename — no test expectation may change.

## Slices (atomic, each ends green)

- [ ] **Slice 0 — characterization net.** Engine surface used by today's facade
      callers covered through per-test `new MarkdownEngine()` instances. This is
      a pure rename, so the net passes immediately by design (characterization,
      not new behavior); the red moment is the deletion in Slice 3, where any
      un-migrated facade import breaks typecheck.
- [ ] **Slice 1 — tests cross the seam.**
  - [ ] `tests/unit/callout.test.ts`, `tests/unit/markdown-export.test.ts`,
        `tests/unit/obsidian-import.test.ts`: import-path switch only, assertions
        unchanged.
  - [ ] Fold `tests/unit/markdown-io.test.ts` + `tests/unit/yjs-seed.test.ts`
        into `tests/unit/markdown-engine.test.ts` (per-test instances) and delete
        the two facade test files.
- [ ] **Slice 2 — production callers:** `lib/import-hydration.ts`,
      `services/import.ts`, `services/obsidian-import.ts`, `lib/markdown-export.ts`.
- [ ] **Slice 3 — deletion:** delete both facades; fix stale comment at
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
