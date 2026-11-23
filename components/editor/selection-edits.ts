import { Fragment, Slice, type Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

export function suggestionTransaction(state: EditorState, selection: { doc: Node; from: number; to: number }, result: string, append: boolean) {
  const { doc, from, to } = selection
  if (!state.doc.eq(doc) || !result.trim()) return null

  const { schema, tr } = state
  const lines = result.split(/\r\n?|\n/)
  if (!append && lines.length === 1) {
    tr.insertText(result, from, to)
  } else {
    const paragraphs = Fragment.fromArray(lines.map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined)))
    if (append) {
      const endOfBlock = doc.resolve(to).after()
      tr.replaceRange(endOfBlock, endOfBlock, new Slice(paragraphs, 0, 0))
    } else tr.replaceRange(from, to, Slice.maxOpen(paragraphs))
  }
  return tr.docChanged ? tr : null
}
