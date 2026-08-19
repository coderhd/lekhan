import type { JSONContent } from '@tiptap/core'

export interface CollectedCodeBlock {
	language: string | null
	text: string
}

/** Collect every `codeBlock` node in a doc, with its language and full text. */
export function collectCodeBlocks(doc: JSONContent | undefined): CollectedCodeBlock[] {
	const blocks: CollectedCodeBlock[] = []
	const walk = (node: JSONContent | undefined) => {
		if (!node) return
		if (node.type === 'codeBlock') {
			blocks.push({
				language: (node.attrs?.language as string | undefined) ?? null,
				text: (node.content?.[0] as { text?: string } | undefined)?.text ?? '',
			})
		}
		for (const child of node.content ?? []) walk(child)
	}
	walk(doc)
	return blocks
}