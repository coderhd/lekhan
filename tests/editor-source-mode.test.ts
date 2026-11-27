import { describe, expect, it } from 'vitest'
import { requiresMarkdownSource } from '../components/editor/source-mode'

describe('Markdown source mode', () => {
  it.each([
    '| Name | Plan |\n| --- | --- |\n| Lekhan | Write |',
    'See ![Alt text](figures/study.png "Figure 1").',
    '> An embedded ![diagram](diagram.svg).',
    'Raw <span class="retained">HTML</span>.',
    'A note.\n\n[unused]: https://example.com/kept "Metadata"',
    'A detail[^one].\n\n[^one]: The original detail.',
    '---\ntags: [writing]\n---\n\nWrite here.',
    'Read the ![[Research/Setup]] embed.',
  ])('protects Markdown rich editing cannot represent: %s', (source) => {
    expect(requiresMarkdownSource(source)).toBe(true)
  })

  it.each([
    '## Write here\n\n- [x] Use **Markdown** with [[a page]].',
    'Read [the guide](https://example.com).',
    '---\n\nA paragraph\n\n---',
    'A literal `<em>element</em>`, `![alt](image.png)` and `[^note]`.\n\n```md\n| A | B |\n| --- | --- |\n[^n]: example\n```',
    'A literal \\[^note] without a definition.',
    'Opening multiline prose.\n[not a definition]: This is regular prose.',
  ])('keeps rich editing for representable Markdown: %s', (source) => {
    expect(requiresMarkdownSource(source)).toBe(false)
  })
})
