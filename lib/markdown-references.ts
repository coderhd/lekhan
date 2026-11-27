interface WikiLink {
  start: number
  end: number
  target: string
  alias: string | undefined
  embed: boolean
}

export function proseRanges(markdown: string): { start: number; end: number }[] {
  const ranges = []
  let fence: string | undefined
  let indentedCode = false
  let startsParagraph = true
  let listIndent = 0
  let start = 0
  let end = 0

  for (const line of markdown.split('\n')) {
    const offset = end
    end += line.length + 1
    const unquoted = line.replace(/^(?: {0,3}>[ \t]?)+/, '')
    const blank = !unquoted.trim()
    const spaces = /^[ \t]*/.exec(unquoted)?.[0].replace(/\t/g, '    ').length ?? 0
    const relativeIndent = spaces >= listIndent ? spaces - listIndent : spaces
    const marker = /^(`{3,}|~{3,})([^\n]*)/.exec(unquoted.trimStart())

    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = undefined
      }
      start = end
      continue
    }

    if (!blank && spaces < listIndent) listIndent = 0
    const isIndentedCode: boolean = (indentedCode && blank) || ((indentedCode || startsParagraph) && relativeIndent >= 4)
    const opensFence = relativeIndent < 4 && marker && !(marker[1][0] === '`' && marker[2].includes('`'))

    if (blank || isIndentedCode || opensFence) {
      if (offset > start) ranges.push({ start, end: offset })
      start = end
    }
    if (opensFence) fence = marker[1]
    indentedCode = isIndentedCode
    startsParagraph = blank || Boolean(opensFence) || isIndentedCode

    const listMarker = /^( *)(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(unquoted)
    if (listMarker) listIndent = listMarker[0].length
  }
  if (start < markdown.length) ranges.push({ start, end: markdown.length })
  return ranges
}

export function escaped(text: string, offset: number) {
  let previous = offset - 1
  while (previous >= 0 && text[previous] === '\\') previous--
  return (offset - previous) % 2 === 0
}

export function wikiLinks(markdown: string, includeEmbeds = false): WikiLink[] {
  const links: WikiLink[] = []
  const pattern = /(?<code>`+)|(?<embed>!)?\[\[(?<target>[^|\]\r\n]+)(?:\|(?<alias>[^\]\r\n]+))?\]\]/g

  for (const { start, end } of proseRanges(markdown)) {
    const prose = markdown.slice(start, end)
    pattern.lastIndex = 0
    for (let match = pattern.exec(prose); match; match = pattern.exec(prose)) {
      const groups = match.groups
      if (!groups || escaped(prose, match.index)) continue
      if (groups.code) {
        const delimiter = /`+/g
        delimiter.lastIndex = pattern.lastIndex
        for (let closing = delimiter.exec(prose); closing; closing = delimiter.exec(prose)) {
          if (closing[0].length === groups.code.length) {
            pattern.lastIndex = delimiter.lastIndex
            break
          }
        }
        continue
      }
      const target = groups.target?.trim()
      const embed = !!groups.embed
      if (!target || (embed && !includeEmbeds)) continue
      links.push({ target, embed, alias: groups.alias, start: start + match.index, end: start + pattern.lastIndex })
    }
  }
  return links
}
