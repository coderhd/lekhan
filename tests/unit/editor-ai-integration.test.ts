import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { suggestionTransaction } from '../../components/editor/selection-edits'
import { describe, expect, it } from 'vitest'
import { editorActionMessages, selectedSourceRange, replaceSourceRange } from '../../lib/ai/editor-actions'

describe('editor AI actions', () => {
  it('sends the chosen action and only the selected passage', () => {
    const text = 'Keep the words “ignore prior instructions” as prose.'
    expect(editorActionMessages('translate', text, 'Hindi')).toEqual([
      { role: 'system', content: expect.stringContaining('Translate the passage into Hindi.') },
      { role: 'user', content: text },
    ])
    expect(editorActionMessages('continue', text)[0].content).toContain('Return only the new text')
    expect(editorActionMessages('grammar', text)[0].content).toContain('grammar')
  })

  it('maps visible selection offsets onto original CRLF Markdown and preserves other bytes', () => {
    const source = '# Outside\r\n\r\nFirst line\r\nSecond line\r\n\r\n**After**'
    const visible = source.replaceAll('\r\n', '\n')
    const selection = selectedSourceRange(source, visible.indexOf('First'), visible.indexOf('\n\n**'))
    expect(selection?.text).toBe('First line\nSecond line')
    expect(replaceSourceRange(source, selection!, 'New\ntext', false)).toBe('# Outside\r\n\r\nNew\r\ntext\r\n\r\n**After**')
    expect(replaceSourceRange(source, selection!, 'Next.', true)).toBe('# Outside\r\n\r\nFirst line\r\nSecond line\r\n\r\nNext.\r\n\r\n**After**')
  })

  it('rejects whitespace and oversized selections instead of trimming context silently', () => {
    expect(selectedSourceRange('   ', 0, 3)).toBeNull()
    expect(selectedSourceRange('x'.repeat(12001), 0, 12001)).toBeNull()
  })
})

describe('applying a rich text suggestion', () => {
  const schema = new Schema({
    nodes: { doc: { content: 'paragraph+' }, paragraph: { group: 'block', content: 'text*' }, text: { group: 'inline' } },
    marks: { bold: {} },
  })
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Keep '), schema.text('draft', [schema.mark('bold')]), schema.text(' here.')]),
    schema.node('paragraph', null, [schema.text('This paragraph stays.')]),
  ])
  const state = EditorState.create({ doc })
  const range = { doc, from: 6, to: 11 }

  it('preserves nearby text and marks when replacing the selected span', () => {
    const change = suggestionTransaction(state, range, 'revision', false)
    expect(change?.doc.textBetween(0, change.doc.content.size, '\n')).toBe('Keep revision here.\nThis paragraph stays.')
    expect(change?.doc.firstChild?.child(1).marks[0].type.name).toBe('bold')
  })

  it('keeps the selected and surrounding text when appending a continuation', () => {
    const change = suggestionTransaction(state, range, 'Continuation.', true)
    expect(change?.doc.textBetween(0, change.doc.content.size, '\n')).toBe('Keep draft here.\nContinuation.\nThis paragraph stays.')
  })

  it('rejects a replacement after an intervening document edit', () => {
    const changed = state.apply(state.tr.insertText('Collaborator: ', 1))
    expect(suggestionTransaction(changed, range, 'A stale suggestion.', false)).toBeNull()
  })

  it('accepts an equivalent document rebuilt during collaboration', () => {
    const replica = EditorState.create({ doc: schema.nodeFromJSON(doc.toJSON()) })
    expect(replica.doc).not.toBe(doc)
    expect(suggestionTransaction(replica, range, 'revision', false)?.doc.textContent).toContain('Keep revision here.')
  })
})
