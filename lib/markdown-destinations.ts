import { parse, postprocess, preprocess } from 'micromark'
import { decodeString } from 'micromark-util-decode-string'

/** Rewrite only parsed link destinations, retaining labels, titles, and literal examples. */
export function mapMarkdownDestinations(markdown: string, replace: (target: string) => string | undefined) {
  const source = markdown.startsWith('\uFEFF') ? markdown.slice(1) : markdown
  const events = postprocess(parse().document().write(preprocess()(source, undefined, true)))
  const pieces = [markdown.slice(0, markdown.length - source.length)]
  let cursor = 0
  for (const [action, token] of events) {
    if (action !== 'enter' || (token.type !== 'resourceDestinationString' && token.type !== 'definitionDestinationString')) continue
    const start = token.start.offset
    const end = token.end.offset
    const value = replace(decodeString(source.slice(start, end)))
    if (value === undefined) continue
    pieces.push(source.slice(cursor, start), value)
    cursor = end
  }
  pieces.push(source.slice(cursor))
  return pieces.join('')
}
