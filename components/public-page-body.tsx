import { Fragment, type ReactNode } from 'react'
import { Marked, type Token, type Tokens } from 'marked'
import { splitYamlFrontmatter, isEmbeddedRaster } from '../lib/markdown'
import { wikiLinks } from '../lib/markdown-references'
import { toTitleKey } from '../lib/cloud/graph-index'
import { inlineCloudImages } from '../lib/cloud/image-policy'

const readerMarkdown = new Marked()

function tokenizeSource(markdown: string) {
  const images = new Map<string, string>()
  let text = ''
  let cursor = 0
  let prefix: string | undefined
  for (const image of inlineCloudImages(markdown)) {
    if (image.source.length <= 64 * 1024) continue
    // The Markdown lexer uses recursive link patterns. Keep raster bytes out of those patterns.
    prefix ??= 'lekhan-embedded-image:' + crypto.randomUUID() + '/'
    const reference = prefix + images.size
    images.set(reference, image.source)
    text += markdown.slice(cursor, image.start) + reference
    cursor = image.end
  }
  return { source: cursor ? text + markdown.slice(cursor) : markdown, images }
}

function headingId(value: string) {
  return value.toLowerCase().normalize('NFC').trim().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/\s+/g, '-')
}

function safeHref(value: string) {
  if (value.startsWith('#')) return '#' + encodeURIComponent(headingId(value.slice(1)))
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export default function PublicPageBody({ source, targets }: { source: string; targets: Map<string, string> }) {
  const headings = new Set<string>()
  const markdown = tokenizeSource(splitYamlFrontmatter(source)?.body ?? source)

  function literal(text: string) {
    return markdown.images.size ? text.replace(/lekhan-embedded-image:[\da-f-]{36}\/\d+/g, ref => markdown.images.get(ref) ?? ref) : text
  }

  function textWithLinks(value: string) {
    const pieces: ReactNode[] = []
    let end = 0
    for (const link of wikiLinks(value)) {
      const [target, anchor] = link.target.split('#', 2)
      const id = target && targets.get(toTitleKey(target))
      const label = link.alias ?? link.target
      const heading = anchor ? '#' + encodeURIComponent(headingId(anchor)) : ''
      pieces.push(literal(value.slice(end, link.start)))
      pieces.push(id || (!target && heading) ? <a key={link.start} href={(id ? '/page/' + id : '') + heading}>{label}</a> : label)
      end = link.end
    }
    pieces.push(literal(value.slice(end)))
    return pieces
  }

  function render(tokens: Token[], insideLink = false): ReactNode {
    return tokens.map((token, index) => <Fragment key={index}>{renderToken(token, insideLink)}</Fragment>)
  }

  function renderToken(token: Token, insideLink: boolean): ReactNode {
    switch (token.type) {
      case 'space': return null
      case 'paragraph': return <p>{render((token as Tokens.Paragraph).tokens)}</p>
      case 'heading': {
        const item = token as Tokens.Heading
        const tag = `h${Math.min(6, item.depth + 1)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        const Heading = tag
        const base = headingId(item.text)
        let id = base
        for (let index = 2; id && headings.has(id); index++) id = base + '-' + index
        if (id) headings.add(id)
        return <Heading id={id || undefined}>{render(item.tokens)}</Heading>
      }
      case 'text': {
        const item = token as Tokens.Text
        return item.tokens ? render(item.tokens, insideLink) : insideLink ? literal(item.text) : textWithLinks(item.text)
      }
      case 'escape': return (token as Tokens.Escape).text
      case 'strong': return <strong>{render((token as Tokens.Strong).tokens, insideLink)}</strong>
      case 'em': return <em>{render((token as Tokens.Em).tokens, insideLink)}</em>
      case 'del': return <del>{render((token as Tokens.Del).tokens, insideLink)}</del>
      case 'codespan': return <code>{(token as Tokens.Codespan).text}</code>
      case 'code': return <pre><code>{(token as Tokens.Code).text}</code></pre>
      case 'br': return <br />
      case 'hr': return <hr />
      case 'html': return <span>{literal((token as Tokens.HTML).text)}</span>
      case 'blockquote': {
        const item = token as Tokens.Blockquote
        const callout = /^\[!([a-z0-9_-]{1,24})\][+-]?(?:[ \t]+([^\r\n]*))?(?:\r?\n|$)/i.exec(item.text)
        if (!callout) return <blockquote>{render(item.tokens)}</blockquote>
        return <aside className="public-callout">
          <strong>{callout[2] || callout[1].charAt(0).toUpperCase() + callout[1].slice(1)}</strong>
          {render(readerMarkdown.lexer(item.text.slice(callout[0].length)))}
        </aside>
      }
      case 'link': {
        const item = token as Tokens.Link
        const href = safeHref(item.href)
        return href ? <a href={href} rel="noreferrer">{render(item.tokens, true)}</a> : render(item.tokens, true)
      }
      case 'image': {
        const item = token as Tokens.Image
        const src = markdown.images.get(item.href) ?? item.href
        if (!isEmbeddedRaster(src)) return item.text
        const size = /^lekhan-size:(\d{1,4})(?:x(\d{1,4}))?$/.exec(item.title ?? '')
        // eslint-disable-next-line @next/next/no-img-element -- raster data is already embedded in the page snapshot
        return <img src={src} alt={item.text} width={size?.[1]} height={size?.[2]} loading="lazy" />
      }
      case 'list': {
        const list = token as Tokens.List
        const items = list.items.map((item, index) => <li key={index}>
          {item.task && !item.tokens.some(child => child.type === 'checkbox') && <input type="checkbox" checked={item.checked} disabled aria-label="Task status" />}
          {render(item.tokens)}
        </li>)
        return list.ordered ? <ol start={typeof list.start === 'number' ? list.start : undefined}>{items}</ol> : <ul>{items}</ul>
      }
      case 'checkbox': return <input type="checkbox" checked={Boolean(token.checked)} disabled aria-label="Task status" />
      case 'table': {
        const table = token as Tokens.Table
        return <div className="public-table"><table>
          <thead><tr>{table.header.map((cell, index) => <th scope="col" key={index}>{render(cell.tokens)}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{render(cell.tokens)}</td>)}</tr>)}</tbody>
        </table></div>
      }
      default: return null
    }
  }

  return <div className="public-prose">{render(readerMarkdown.lexer(markdown.source))}</div>
}
