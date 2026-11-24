'use client'

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { type Editor, EditorContent, useEditor } from '@tiptap/react'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { FileText, Link2 } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import { trackWritingEdit } from '@/lib/analytics'
import type { CloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import type { CloudImagePolicy } from '@/lib/cloud/image-policy'
import type { PageChoice } from '@/lib/types'
import { blockCommands } from './editor/block-commands'
import { CommandMenu, type CommandItem } from './editor/command-menu'
import { type CommandMatch, findCommand, validWikiLink } from './editor/editor-commands'
import { FormatToolbar } from './editor/format-toolbar'
import CloudImageControl from './editor/cloud-image-control'
import { requiresMarkdownSource } from './editor/source-mode'
import { AssistedMarkdownSource, RichSelectionAI, type EditorAssistant } from './editor/selection-ai'
import { useEditorPreferences } from './settings/appearance-settings'
import { collaborativeWritingExtensions, writingExtensions } from './editor/writing-extensions'
import './editor/editor.css'

interface PageEditorProps {
  markdown: string
  pageId: string
  choices: PageChoice[]
  onChange: (markdown: string) => void
  onOpenLink: (target: string) => void
  onOpenAttachment?: (href: string) => boolean
  editable?: boolean
  focusOnMount?: boolean
  collaboration?: CloudCollaboration
  imagePolicy?: CloudImagePolicy
  onSchemaError?: () => void
  showModePicker?: boolean
  assistant?: EditorAssistant
}

interface MenuState {
  match: CommandMatch
  active: number
  manual: boolean
  left: number
  top: number
  above: boolean
}

function isSameMatch(a: CommandMatch | null | undefined, b: CommandMatch) {
  return a?.type === b.type && a.from === b.from && a.to === b.to && a.query === b.query
}

function menuPosition(editor: Editor, position: number) {
  const caret = editor.view.coordsAtPos(position)
  const above = window.innerHeight - caret.bottom < 290 && caret.top >= 220
  return {
    left: Math.max(8, Math.min(caret.left, window.innerWidth - 300 - 8)),
    top: above ? caret.top - 8 : caret.bottom + 8,
    above,
  }
}

function currentMatch(editor: Editor) {
  const { selection } = editor.state
  const { $from } = selection
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code || editor.isActive('code')) {
    return null
  }

  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '\uFFFC')
  const match = findCommand(text, $from.start())
  if (match?.type === 'block' && ($from.parent.type.name !== 'paragraph' || $from.depth !== 1)) {
    return null
  }
  return match
}

function getItems(choices: PageChoice[], pageId: string, match: CommandMatch): CommandItem[] {
  const query = match.query.trim().toLowerCase()
  if (match.type === 'block') {
    return blockCommands
      .filter((command) => `${command.label} ${command.aliases}`.toLowerCase().includes(query))
      .map((command) => ({
        id: command.label,
        title: command.label,
        icon: command.icon,
      }))
  }

  const items: CommandItem[] = []
  for (const page of choices) {
    if (page.id === pageId || !validWikiLink(page.title) || !validWikiLink(page.path)) continue
    if (!page.title.toLowerCase().includes(query) && !page.path.toLowerCase().includes(query)) continue
    items.push({
      id: page.id,
      title: page.title,
      description: page.path !== page.title ? page.path : undefined,
      icon: FileText,
    })
    if (items.length === 12) break
  }

  const unresolved = match.query.trim()
  if (items.length === 0 && validWikiLink(unresolved)) {
    items.push({
      id: 'unresolved',
      title: unresolved,
      description: 'Link to an unwritten page',
      icon: Link2,
    })
  }
  return items
}

export default function PageEditor(props: PageEditorProps) {
  if (props.collaboration) return <PageEditorSession key={props.pageId} {...props} modePicker={null} />
  return <PageEditorView key={props.pageId} {...props} />
}

function PageEditorView(props: PageEditorProps) {
  const editorText = useTranslations('editor-chrome')
  const { spellcheck } = useEditorPreferences()
  const { markdown, onChange, editable = true, focusOnMount = false, showModePicker = true } = props
  const sourceOnly = useMemo(() => requiresMarkdownSource(markdown), [markdown])
  const [preferSource, setPreferSource] = useState(sourceOnly)
  const [focusAfterSwitch, setFocusAfterSwitch] = useState(false)
  const source = sourceOnly || preferSource
  const hintId = useId()

  function selectMode(nextSource: boolean) {
    if (source === nextSource) return
    setFocusAfterSwitch(true)
    setPreferSource(nextSource)
  }

  const modePicker = showModePicker ? (
    <div className="writer-mode-picker" role="group" aria-label={editorText('editorMode')}>
      <button
        type="button"
        aria-pressed={!source}
        disabled={sourceOnly}
        onClick={() => selectMode(false)}
      >
        {editorText('write')}
      </button>
      <button type="button" aria-pressed={source} onClick={() => selectMode(true)}>
        {editorText('markdown')}
      </button>
    </div>
  ) : null

  const focusBody = focusOnMount || focusAfterSwitch
  if (!source) return <PageEditorSession {...props} focusOnMount={focusBody} modePicker={modePicker} />

  return (
    <div className="writer-editor">
      <div className="writer-toolbar">{modePicker}</div>
      {sourceOnly && (
        <p id={hintId} className="writer-source-hint">
          {editorText('sourceHint')}
        </p>
      )}
      <AssistedMarkdownSource
        assistant={props.assistant}
        className="writer-source"
        aria-label={editorText('markdownSource')}
        aria-describedby={sourceOnly ? hintId : undefined}
        autoFocus={focusBody}
        markdown={markdown}
        readOnly={!editable}
        spellCheck={spellcheck}
        placeholder={editorText('markdownPlaceholder')}
        onChange={(value) => {
          setPreferSource(true)
          const windowsLineEndings = markdown.includes('\r\n') && !/(?<!\r)\n/.test(markdown)
          const next = windowsLineEndings ? value.replace(/\r?\n/g, '\r\n') : value
          onChange(next)
          if (editable) trackWritingEdit(markdown, next)
        }}
      />
    </div>
  )
}

function PageEditorSession({
  markdown,
  pageId,
  choices,
  onChange,
  onOpenLink,
  onOpenAttachment,
  editable = true,
  focusOnMount = false,
  modePicker,
  collaboration,
  imagePolicy,
  onSchemaError,
  assistant,
}: PageEditorProps & { modePicker: ReactNode }) {
  const editorText = useTranslations('editor-chrome')
  const { spellcheck } = useEditorPreferences()
  const menuId = useId()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuState = useRef<MenuState | null>(null)
  const dismissed = useRef<CommandMatch | null>(null)
  const currentMarkdown = useRef(markdown)
  const wrapper = useRef<HTMLDivElement>(null)

  function updateMenu(next: MenuState | null) {
    menuState.current = next
    setMenu(next)
  }

  function dismissMenu() {
    const activeMenu = menuState.current
    dismissed.current = activeMenu?.manual ? null : activeMenu?.match ?? null
    updateMenu(null)
  }

  function syncMenu(editor: Editor) {
    if (!editor.isFocused || !editor.isEditable) return

    const active = menuState.current
    if (active?.manual) return
    const match = currentMatch(editor)

    if (!match) {
      dismissed.current = null
      if (active) updateMenu(null)
      return
    }
    if (isSameMatch(dismissed.current, match)) return
    dismissed.current = null
    if (isSameMatch(active?.match, match)) return
    updateMenu({ match, active: 0, manual: false, ...menuPosition(editor, match.to) })
  }

  function chooseBlock(editor: Editor, state: MenuState, command: typeof blockCommands[number]) {
    dismissMenu()
    const chain = editor.chain().focus()
    if (state.manual) {
      const cursor = editor.state.doc.resolve(state.match.to)
      const inEmptyParagraph =
        state.match.from === state.match.to &&
        cursor.depth === 1 &&
        cursor.parent.type.name === 'paragraph' &&
        cursor.parent.content.size === 0
      if (!inEmptyParagraph) {
        const insertAt = cursor.depth ? cursor.after(1) : editor.state.doc.content.size
        chain.insertContentAt(insertAt, { type: 'paragraph' }).setTextSelection(insertAt + 1)
      }
    } else {
      chain.deleteRange({ from: state.match.from, to: state.match.to })
    }

    command.apply(chain).run()
  }

  function chooseLink(editor: Editor, state: MenuState, target: string, label: string) {
    dismissMenu()
    editor.chain().focus().insertContentAt(
      { from: state.match.from, to: state.match.to },
      [{ type: 'pageLink', attrs: { target, label } }, { type: 'text', text: ' ' }],
    ).run()
  }

  function selectItem(editor: Editor, state: MenuState, item: CommandItem) {
    if (state.match.type === 'block') {
      const command = blockCommands.find((candidate) => candidate.label === item.id)
      if (command) chooseBlock(editor, state, command)
      return
    }

    const page = choices.find((candidate) => candidate.id === item.id)
    chooseLink(editor, state, page?.path ?? item.title, item.title)
  }

  function handleMenuKey(editor: Editor, event: KeyboardEvent) {
    const active = menuState.current
    if (!active || event.isComposing) return false

    if (event.key === 'Escape') {
      event.stopPropagation()
      dismissMenu()
      return true
    }
    if (event.key === 'Tab') {
      dismissMenu()
      return false
    }

    const items = getItems(choices, pageId, active.match)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const index = (active.active + direction + items.length) % Math.max(items.length, 1)
      updateMenu({ ...active, active: index })
      return true
    }
    if (event.key === 'Enter' && items.length) {
      selectItem(editor, active, items[Math.min(active.active, items.length - 1)])
      return true
    }
    if (active.manual && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const key = event.key
      if (key === 'Backspace' || (key.length === 1 && (key === ' ' || validWikiLink(key)))) {
        const query = key === 'Backspace' ? active.match.query.slice(0, -1) : active.match.query + key
        updateMenu({ ...active, active: 0, match: { ...active.match, query } })
        return true
      }
    }
    if (active.manual || event.key === 'Enter') dismissMenu()
    return false
  }

  const menuOpen = menu !== null
  const items = menu ? getItems(choices, pageId, menu.match) : []
  const activeItem = Math.max(0, Math.min(menu?.active ?? 0, items.length - 1))

  function activatePageLink(event: MouseEvent | KeyboardEvent) {
    if (event instanceof KeyboardEvent && (event.key !== 'Enter' || event.isComposing)) return false
    if (!(event.target instanceof Element)) return false
    const target = event.target.closest('[data-page-link]')?.getAttribute('data-page-link')
    if (!target) return false
    event.preventDefault()
    onOpenLink(target)
    return true
  }

  const extensions = useMemo(() => collaboration ? collaborativeWritingExtensions(collaboration) : writingExtensions, [collaboration])

  const editor: Editor | null = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions,
    ...(collaboration ? { enableContentCheck: true } : { content: markdown, contentType: 'markdown' as const }),
    onContentError: ({ disableCollaboration }) => {
      disableCollaboration()
      onSchemaError?.()
    },
    editable,
    autofocus: focusOnMount ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'writer-content',
        role: 'textbox',
        'aria-label': editorText('pageContent'),
        'aria-multiline': 'true',
        spellcheck: String(spellcheck),
        'aria-placeholder': editorText('writePlaceholder'),
        style: '--writer-placeholder: ' + JSON.stringify(editorText('writePlaceholder')),
        ...(menuOpen ? { 'aria-controls': menuId } : {}),
        ...(items.length ? { 'aria-activedescendant': `${menuId}-${activeItem}` } : {}),
      },
      handleKeyDown: (_view, event) => editor ? handleMenuKey(editor, event) : false,
      handleDOMEvents: {
        click: (_view, event) => activatePageLink(event),
        keydown: (_view, event) => activatePageLink(event),
      },
    },
    onCreate: ({ editor: current }) => {
      if (collaboration) {
        currentMarkdown.current = current.getMarkdown()
        onChange(currentMarkdown.current)
      }
    },
    onUpdate: ({ editor: current, transaction }) => {
      const value = current.getMarkdown()
      const previous = currentMarkdown.current
      currentMarkdown.current = value
      onChange(value)
      if (current.isEditable && !isChangeOrigin(transaction)) trackWritingEdit(previous, value)
    },
    onTransaction: ({ editor: current }) => {
      if (!current.isDestroyed && current.isInitialized) syncMenu(current)
    },
    onBlur: () => {
      if (menuState.current) dismissMenu()
    },
  })

  useEffect(() => {
    if (!editor || editor.isEditable === editable) return
    editor.setEditable(editable, false)
  }, [editor, editable])

  useEffect(() => {
    if (!editor || collaboration) return
    if (currentMarkdown.current === markdown) return

    currentMarkdown.current = markdown
    if (editor.getMarkdown() !== markdown) {
      editor.chain()
        .setMeta('addToHistory', false)
        .setContent(markdown, { contentType: 'markdown', emitUpdate: false })
        .run()
    }
  }, [collaboration, editor, markdown])

  useEffect(() => {
    if (!editor || !menuOpen) return

    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return
      if (wrapper.current?.contains(event.target)) return
      if (event.target.closest('[data-writer-command-menu]')?.getAttribute('data-writer-command-menu') === menuId) return
      const current = menuState.current
      if (!current) return
      dismissed.current = current.manual ? null : current.match
      menuState.current = null
      setMenu(null)
    }
    const move = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-writer-command-menu]')) return
      const current = menuState.current
      if (!current || editor.isDestroyed) return
      const position = menuPosition(editor, current.match.to)
      if (position.left === current.left && position.top === current.top && position.above === current.above) return
      const next = { ...current, ...position }
      menuState.current = next
      setMenu(next)
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('resize', move)
    window.addEventListener('scroll', move, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('resize', move)
      window.removeEventListener('scroll', move, true)
    }
  }, [editor, menuOpen, menuId])

  function openManual(type: CommandMatch['type']) {
    if (!editor) return
    const { from, to } = editor.state.selection
    const match = { type, query: '', from, to }
    editor.commands.focus(undefined, { scrollIntoView: false })
    updateMenu({ match, active: 0, manual: true, ...menuPosition(editor, match.to) })
  }

  function downloadAttachment(event: React.MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return
    const href = event.target.closest('a')?.getAttribute('href')
    if (!href || !onOpenAttachment?.(href)) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="writer-editor" ref={wrapper}
      onClickCapture={onOpenAttachment ? downloadAttachment : undefined}>
      {editor && editable && (
        <FormatToolbar
          editor={editor}
          openBlocks={() => openManual('block')}
          openPageLinks={() => openManual('page')}
          openMenu={menu?.match.type}
          menuId={menuId}
        >
          {modePicker}
          {imagePolicy && <CloudImageControl policy={imagePolicy} compact onInsert={(src, alt) => {
            if (editor.isEditable && !editor.isDestroyed) editor.chain().focus()
              .insertContent({ type: 'image', attrs: { src, alt } }).run()
          }} />}
        </FormatToolbar>
      )}
      {(!editor || !editable) && <div className="writer-toolbar">{modePicker}</div>}
      <EditorContent editor={editor} />
      {editor && editable && assistant && <RichSelectionAI editor={editor} assistant={assistant} formattingMenuOpen={menuOpen} />}
      {editor && menu && (
        <CommandMenu
          id={menuId}
          title={menu.match.type === 'block' ? 'Blocks' : 'Link a page'}
          items={items}
          active={activeItem}
          left={menu.left}
          top={menu.top}
          above={menu.above}
          select={(item) => selectItem(editor, menu, item)}
        />
      )}
    </div>
  )
}
