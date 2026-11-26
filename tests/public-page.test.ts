import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownManager } from '@tiptap/markdown'
import PublicPageBody from '../components/public-page-body'
import { writingExtensions } from '../components/editor/writing-extensions'

const linked = 'e6a3a67a-bf74-4f17-b013-95eb59b2e937'
const render = (source: string, taskStatus = 'Task status') => renderToStaticMarkup(createElement(PublicPageBody, {
  source, targets: new Map([['follow-up', linked]]), taskStatus,
}))

describe('public page body', () => {
  it('renders task state with the supplied accessible label', () => {
    const html = render('- [x] First task\n- [ ] Second task', 'Estado de la tarea')
    expect(html.match(/aria-label="Estado de la tarea"/g)).toHaveLength(2)
    expect(html.match(/\bchecked=""/g)).toHaveLength(1)
    expect(html).toContain('Second task')
  })

  it('renders an article, callouts and public wikilinks without exposing frontmatter', () => {
    new MarkdownManager({ extensions: writingExtensions })
    const html = render('---\ntags: [internal]\n---\n# Meeting notes\n\nA **draft** with [[Follow-up|more]] and [[Private notes|an aside]].\n\n> [!note] Follow up\n> Schedule a discussion.')
    expect(html).toContain('<h2 id="meeting-notes">Meeting notes</h2>')
    expect(html).toContain('<strong>draft</strong>')
    expect(html).toContain(`<a href="/page/${linked}">more</a>`)
    expect(html).toContain('and an aside.')
    expect(html).toContain('<strong>Follow up</strong>')
    expect(html).not.toContain('tags:')
  })

  it('renders raw HTML as text and limits what links and images can load', () => {
    const html = render('<div>Literal HTML</div>\n\n[invalid](javascript:void) ![remote](https://example.test/image.png)\n\n![embedded](data:image/png;base64,iVBORw0KGgo=)')
    expect(html).toContain('&lt;div&gt;Literal HTML&lt;/div&gt;')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('src="https://')
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
  })

  it('renders a paid-size embedded raster without parsing its bytes as Markdown', () => {
    const raster = 'data:image/png;base64,' + 'AAAA'.repeat(6_500_000)
    const html = render('Before the image.\n\n![Field scan](' + raster + ')\n\nAfter the image.')
    expect(html.includes('src="' + raster + '"')).toBe(true)
    expect(html.includes('alt="Field scan"')).toBe(true)
    expect(html.endsWith('<p>After the image.</p></div>')).toBe(true)
  })
})
