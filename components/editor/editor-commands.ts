export interface CommandMatch {
  type: 'block' | 'page'
  query: string
  from: number
  to: number
}

export function validWikiLink(value: string) {
  return value.trim().length > 0 && !/[\[\]|\n\r\\]/.test(value)
}

export function findCommand(textBeforeCaret: string, blockStart: number): CommandMatch | null {
  const slash = /^\/([\p{L}\p{N} -]*)$/u.exec(textBeforeCaret)
  if (slash) {
    return { type: 'block', query: slash[1], from: blockStart, to: blockStart + slash[0].length }
  }

  const link = /(?<!\\)\[\[([^\[\]\n\r|\\\uFFFC]*)$/.exec(textBeforeCaret)
  if (link) {
    return {
      type: 'page',
      query: link[1],
      from: blockStart + link.index,
      to: blockStart + textBeforeCaret.length,
    }
  }

  return null
}
