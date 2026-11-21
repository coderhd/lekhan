import { Marked } from 'marked'
import { hasYamlFrontmatter } from '../../lib/markdown'

const lexer = new Marked({ gfm: true })
const sourceOnlyTokens = new Set(['table', 'image', 'html', 'def'])

const footnoteOrEmbed = /(?<!\\)(?:\[\^[^\]\r\n]+\]|!\[\[[^\]\r\n]+\]\])/
const closingCodeFence = /^ {0,3}`{3,}[ \t]*$/m

export function requiresMarkdownSource(source: string): boolean {
  if (hasYamlFrontmatter(source)) return true

  try {
    const tokens = lexer.lexer(source)
    let sourceOnly = Object.keys(tokens.links).length > 0
    lexer.walkTokens(tokens, (token) => {
      if (sourceOnly) return
      sourceOnly =
        sourceOnlyTokens.has(token.type) ||
        (token.type === 'text' && footnoteOrEmbed.test(token.raw)) ||
        (token.type === 'code' && closingCodeFence.test(token.text)) ||
        (token.type === 'link' && (/[\s<>]/.test(token.href) || /"/.test(token.title ?? '')))
    })
    return sourceOnly
  } catch {
    return true
  }
}
