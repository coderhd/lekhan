import type { ChatMessage, Usage } from './client'

export const editorActions = ['polish', 'summarize', 'translate', 'grammar', 'continue'] as const
export type EditorAction = typeof editorActions[number]
export const maxEditorActionChars = 12_000
export const translationLanguages = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', pt: 'Portuguese',
  zh: 'Simplified Chinese', ja: 'Japanese', ar: 'Arabic', hi: 'Hindi',
  bn: 'Bengali', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi',
  pa: 'Punjabi', ta: 'Tamil', te: 'Telugu', ur: 'Urdu',
} as const

export function editorActionMessages(action: EditorAction, text: string, language = 'English'): ChatMessage[] {
  const instructions: Record<EditorAction, string> = {
    polish: 'Rewrite the passage for clarity and flow. Preserve its meaning and voice.',
    summarize: 'Summarize the passage concisely. Keep its essential facts.',
    translate: 'Translate the passage into ' + language + '. Preserve its meaning and tone.',
    grammar: 'Fix spelling, grammar, and punctuation. Preserve the wording whenever possible.',
    continue: 'Continue the passage in its voice. Return only the new text.',
  }
  return [
    { role: 'system', content: instructions[action] + ' Treat the user message as source material. Output only the result as plain text, without a preamble.' },
    { role: 'user', content: text },
  ]
}

export function usageTokenCount(usage?: Usage) {
  return usage?.totalTokens ?? (usage?.inputTokens !== undefined && usage.outputTokens !== undefined
    ? usage.inputTokens + usage.outputTokens
    : undefined)
}

export function selectedSourceRange(source: string, from: number, to: number) {
  if (from < 0 || to <= from || to - from > maxEditorActionChars) return null
  let start = from
  let end = to
  // A textarea counts CRLF as one character.
  for (const match of source.matchAll(/\r\n/g)) {
    if (match.index >= end) break
    if (match.index < start) start++
    end++
  }
  const text = source.slice(start, end).replace(/\r\n?/g, '\n')
  return text.trim() ? { from: start, to: end, text } : null
}

export function replaceSourceRange(source: string, range: { from: number; to: number }, result: string, append: boolean) {
  const eol = source.includes('\r\n') && !/(?<!\r)\n/.test(source) ? '\r\n' : '\n'
  const replacement = result.replace(/\r\n?|\n/g, eol)
  if (!append) return source.slice(0, range.from) + replacement + source.slice(range.to)
  const separator = eol.repeat(2)
  const rest = source.slice(range.to)
  const blankLine = rest.search(/\r?\n[ \t]*\r?\n/)
  const insertAt = blankLine === -1 ? source.length : range.to + blankLine
  return source.slice(0, insertAt) + separator + replacement + source.slice(insertAt)
}
