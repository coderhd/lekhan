import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Markdown } from '@tiptap/markdown'
import { InputRule, Node } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { validWikiLink } from './editor-commands'

const wikiLinkPattern = /^(\[\[([^\[\]\n\r|\\]+)(?:\|([^\[\]\n\r|\\]+))?\]\])/
const typedWikiLinkPattern = /(?<!\\)\[\[([^\[\]\n\r|\\]+)(?:\|([^\[\]\n\r|\\]+))?\]\]$/

const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      target: { default: '', rendered: false },
      label: { default: '', rendered: false },
    }
  },

  parseHTML() {
    return [{
      tag: 'a[data-page-link]',
      getAttrs: (element) => {
        const target = element.getAttribute('data-page-link') ?? ''
        const label = element.textContent?.trim() || target
        return validWikiLink(target) && validWikiLink(label) ? { target, label } : false
      },
    }]
  },

  renderHTML({ node }) {
    const { target, label } = node.attrs
    return [
      'a',
      {
        class: 'writer-page-link',
        href: `#page/${encodeURIComponent(target)}`,
        'data-page-link': target,
        contenteditable: 'false',
      },
      label || target,
    ]
  },

  renderText({ node }) {
    const { target, label } = node.attrs
    return label !== target ? `[[${target}|${label}]]` : `[[${target}]]`
  },

  markdownTokenizer: {
    name: 'pageLink',
    level: 'inline',
    start: '[[',
    tokenize(source) {
      const match = wikiLinkPattern.exec(source)
      if (!match) return

      const target = match[2].trim()
      const label = match[3]?.trim() || target
      if (!validWikiLink(target) || !validWikiLink(label)) return

      return { type: 'pageLink', raw: match[0], target, label }
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('pageLink', { target: token.target, label: token.label })
  },

  renderMarkdown(node) {
    const target = node.attrs?.target ?? ''
    const label = node.attrs?.label || target
    return label !== target ? `[[${target}|${label}]]` : `[[${target}]]`
  },

  addInputRules() {
    return [new InputRule({
      find: typedWikiLinkPattern,
      handler: ({ state, range, match }) => {
        const target = match[1].trim()
        const label = match[2]?.trim() || target
        if (!validWikiLink(target) || !validWikiLink(label)) return null

        state.tr.replaceWith(range.from, range.to, this.type.create({ target, label }))
      },
    })]
  },
})

export const writingExtensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    },
    underline: false,
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: { checkboxLabel: (node) => `Complete ${node.textContent || 'task'}` },
  }),
  PageLink,
  Markdown,
]
