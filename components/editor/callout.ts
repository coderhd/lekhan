import { Node } from '@tiptap/core'

const calloutHeading = /^ {0,3}>[ \t]*\[!([\w-]+)\]([+-]?)[ \t]*([^\n\r]*)(?:\r?\n|$)/

export const Callout = Node.create({
  name: 'vaultCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: { default: 'note', rendered: false },
      title: { default: '', rendered: false },
      fold: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return [{
      tag: 'aside[data-vault-callout]',
      contentElement: '.writer-callout-content',
      getAttrs: element => ({
        kind: element.getAttribute('data-vault-callout') ?? 'note',
        title: element.getAttribute('data-callout-title') ?? '',
        fold: element.getAttribute('data-callout-fold') ?? '',
      }),
    }]
  },

  renderHTML({ node }) {
    const { kind, title, fold } = node.attrs
    const label = title || kind.charAt(0).toUpperCase() + kind.slice(1)
    return [
      'aside',
      { 'data-vault-callout': kind, 'data-callout-title': title, 'data-callout-fold': fold, class: 'writer-callout' },
      ['div', { class: 'writer-callout-title', contenteditable: 'false' }, label],
      ['div', { class: 'writer-callout-content' }, 0],
    ]
  },

  markdownTokenizer: {
    name: 'vaultCallout',
    level: 'block',
    start: '> [!',
    tokenize(source, _tokens, lexer) {
      const heading = calloutHeading.exec(source)
      if (!heading) return
      const body = /^(?: {0,3}>[^\n]*(?:\n|$))*/.exec(source.slice(heading[0].length))?.[0] ?? ''
      return {
        type: 'vaultCallout',
        raw: heading[0] + body,
        kind: heading[1],
        fold: heading[2],
        title: heading[3].trim(),
        tokens: lexer.blockTokens(body.replace(/^ {0,3}>[ \t]?/gm, '')),
      }
    },
  },

  parseMarkdown(token, helpers) {
    const body = (helpers.parseBlockChildren ?? helpers.parseChildren)(token.tokens ?? [])
    return helpers.createNode('vaultCallout', {
      kind: token.kind,
      title: token.title,
      fold: token.fold,
    }, body.length ? body : [{ type: 'paragraph' }])
  },

  renderMarkdown(node, helpers) {
    const { kind = 'note', title = '', fold = '' } = node.attrs ?? {}
    const heading = '> [!' + kind + ']' + fold + (title ? ' ' + title : '')
    const body = helpers.renderChildren(node.content ?? [], '\n\n').trimEnd()
    if (!body) return heading
    return heading + '\n' + body.split('\n').map(line => line ? '> ' + line : '>').join('\n')
  },
})
