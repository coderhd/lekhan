import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type { CloudCollaboration } from '../../lib/sync/use-cloud-collaboration'
import Image from '@tiptap/extension-image'
import Paragraph from '@tiptap/extension-paragraph'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Markdown } from '@tiptap/markdown'
import { InputRule, Node } from '@tiptap/core'
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

const baseStarter = {
    link: {
      openOnClick: false as const,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    },
    underline: false as const,
    paragraph: false as const,
}


export interface WritingExtensionLabels {
  completeTask: (task: string) => string
  defaultTask: string
  collaborator: string
}

const defaultLabels: WritingExtensionLabels = {
  completeTask: (task) => `Complete ${task}`,
  defaultTask: 'task',
  collaborator: 'Collaborator',
}

function sharedExtensions(labels: Pick<WritingExtensionLabels, 'completeTask' | 'defaultTask'> = defaultLabels) {
  return [
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => labels.completeTask(node.textContent || labels.defaultTask) },
    }),
    PageLink,
    VaultImage,
    InlineImageParagraph,
    Callout,
    Markdown,
  ]
}

export function createWritingExtensions(labels: Pick<WritingExtensionLabels, 'completeTask' | 'defaultTask'> = defaultLabels) {
  return [
    StarterKit.configure(baseStarter),
    ...sharedExtensions(labels),
  ]
}

export const writingExtensions = createWritingExtensions()

export function collaborativeWritingExtensions(session: CloudCollaboration, labels: WritingExtensionLabels = defaultLabels) {
  return [
    StarterKit.configure({ ...baseStarter, undoRedo: false }),
    ...sharedExtensions(labels),
    Collaboration.configure({ document: session.document, field: 'default' }),
    CollaborationCaret.configure({
      provider: { awareness: session.awareness },
      user: { name: `${labels.collaborator} ${session.subject.slice(0, 4)}`, color: cursorColor(session.subject) },
      render: user => {
        const marker = document.createElement('span')
        marker.className = 'collaboration-carets__caret'
        marker.setAttribute('aria-hidden', 'true')
        const color = typeof user.color === 'string' && /^#[\da-f]{6}$/i.test(user.color) ? user.color : '#575799'
        marker.style.borderColor = color
        const label = document.createElement('span')
        label.className = 'collaboration-carets__label'
        label.style.backgroundColor = color
        label.textContent = typeof user.name === 'string' ? user.name.slice(0, 40) : labels.collaborator
        marker.append(label)
        return marker
      },
    }),
  ]
}

function cursorColor(subject: string) {
  const palette = ['#7b4e72', '#235e85', '#346946', '#9a4e3d', '#8a5e19', '#575799']
  return palette[Number.parseInt(subject.slice(0, 6), 16) % palette.length] ?? palette[0]
}
