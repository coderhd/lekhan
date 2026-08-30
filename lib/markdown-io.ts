// Facade over lib/markdown/engine.ts — keeps existing import paths working
// New code should import from @/lib/markdown/engine directly.
// Tracking issue #115: migrate 5 prod callers + 3 test files, then delete this facade
// (or keep as stable public API per that issue's decision). Delegates to singleton.

import type { AnyExtension, JSONContent } from '@tiptap/core'
import { markdownEngine } from '@/lib/markdown/engine'
import type { PageMeta, ParsedFrontmatter } from '@/lib/markdown/engine'

export type { PageMeta, ParsedFrontmatter } from '@/lib/markdown/engine'

export function parseMarkdown(markdown: string): JSONContent {
	return markdownEngine.parse(markdown)
}

export function serializeMarkdown(doc: JSONContent, extensions?: AnyExtension[]): string {
	return markdownEngine.serialize(doc, extensions)
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
	return markdownEngine.parseFrontmatter(markdown)
}

export function buildFrontmatter(meta: PageMeta): string | null {
	return markdownEngine.buildFrontmatter(meta)
}

export function assembleMarkdownFile(meta: PageMeta, body: string): string {
	return markdownEngine.assembleMarkdownFile(meta, body)
}
