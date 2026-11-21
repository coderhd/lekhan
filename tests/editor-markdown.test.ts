import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import { writingExtensions } from '../components/editor/writing-extensions'
import { findCommand, validWikiLink } from '../components/editor/editor-commands'

const markdown = new MarkdownManager({ extensions: writingExtensions })

describe('writing Markdown', () => {
  it('preserves the target and label of a page link', () => {
    const source = 'Today I read [[Research/Field notes|the field notes]].'
    const document = markdown.parse(source)
    expect(document.content?.[0].content?.[1]).toMatchObject({
      type: 'pageLink',
      attrs: { target: 'Research/Field notes', label: 'the field notes' },
    })
    expect(markdown.serialize(document)).toBe(source)
  })

  it('keeps page link syntax inside code inert', () => {
    const source = 'A literal `[[Draft]]`.\n\n```text\n[[Draft]]\n```'
    const document = markdown.parse(source)
    expect(JSON.stringify(document)).not.toContain('"pageLink"')
    expect(markdown.serialize(document).trim()).toBe(source)
  })

  it('retains headings, tasks, quotes, formatting, and code together', () => {
    const source = '## Next up\n\n- [x] Capture **ideas**\n- [ ] Review\n\n> A short quote\n\n```js\n123\n```'
    const output = markdown.serialize(markdown.parse(source))
    expect(output).toContain('## Next up')
    expect(output).toContain('- [x] Capture **ideas**')
    expect(output).toContain('- [ ] Review')
    expect(output).toContain('> A short quote')
    expect(output).toContain('```js\n123\n```')
  })
})

describe('writing commands', () => {
  it('triggers slash commands at the start of a block', () => {
    expect(findCommand('/heading', 5)).toEqual({ type: 'block', query: 'heading', from: 5, to: 13 })
    expect(findCommand('Read /heading', 5)).toBeNull()
  })

  it('matches an unfinished page link after prose and ignores escapes', () => {
    expect(findCommand('Read [[Field', 5)).toEqual({ type: 'page', query: 'Field', from: 10, to: 17 })
    expect(findCommand('Read \\[[Field', 5)).toBeNull()
    expect(findCommand('Read [[Field]]', 5)).toBeNull()
  })

  it('rejects a target containing wiki syntax delimiters', () => {
    expect(validWikiLink('Sources/Field notes')).toBe(true)
    expect(validWikiLink('Sources | Field notes')).toBe(false)
    expect(validWikiLink('Sources\nField notes')).toBe(false)
  })
})
