import Image from '@tiptap/extension-image'
import Paragraph from '@tiptap/extension-paragraph'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Markdown } from '@tiptap/markdown'
import { InputRule, Node } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { validWikiLink } from './editor-commands'
import { isEmbeddedRaster } from '../../lib/markdown'
import { Callout } from './callout'

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

const VaultImage = Image.extend({
  addInputRules() { return [] },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: element => isEmbeddedRaster(element.getAttribute('src')) ? null : false }]
  },
  renderHTML({ HTMLAttributes }) {
    const { src, alt, title } = HTMLAttributes
    if (!isEmbeddedRaster(src)) return ['span', {}, String(alt || '')]
    const size = typeof title === 'string' ? /^lekhan-size:(\d{1,4})(?:x(\d{1,4}))?$/.exec(title) : null
    return ['img', { src, alt, loading: 'lazy', width: size?.[1], height: size?.[2], title: size ? undefined : title }]
  },
}).configure({ inline: true, allowBase64: true })

const InlineImageParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
      return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens))
    }
    return this.parent?.(token, helpers) ?? helpers.createNode('paragraph')
  },
})

export const writingExtensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    },
    underline: false,
    paragraph: false,
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: { checkboxLabel: (node) => `Complete ${node.textContent || 'task'}` },
  }),
  PageLink,
  VaultImage,
  InlineImageParagraph,
  Callout,
  Markdown,
]
