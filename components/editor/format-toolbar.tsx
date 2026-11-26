import type { ReactNode } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { Bold, Code2, Italic, Link2, Plus, Strikethrough } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'

interface FormatToolbarProps {
  editor: Editor
  openBlocks: () => void
  openPageLinks: () => void
  openMenu: 'block' | 'page' | undefined
  menuId: string
  children: ReactNode
}

export function FormatToolbar({ editor, openBlocks, openPageLinks, openMenu, menuId, children }: FormatToolbarProps) {
  const t = useTranslations('editor-chrome')
  const marks = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive('bold'),
      italic: currentEditor.isActive('italic'),
      strike: currentEditor.isActive('strike'),
      code: currentEditor.isActive('code'),
      canLink: !currentEditor.isActive('codeBlock') && !currentEditor.isActive('code'),
    }),
  })

  const formats = [
    { key: 'bold', icon: Bold, active: marks.bold, apply: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: Italic, active: marks.italic, apply: () => editor.chain().focus().toggleItalic().run() },
    { key: 'strikethrough', icon: Strikethrough, active: marks.strike, apply: () => editor.chain().focus().toggleStrike().run() },
    { key: 'inlineCode', icon: Code2, active: marks.code, apply: () => editor.chain().focus().toggleCode().run() },
  ] as const

  return (
    <div className="writer-toolbar" role="group" aria-label={t('formatting')}>
      <button
        type="button"
        className="writer-icon-button writer-add-block"
        aria-label={t('addBlock')}
        aria-expanded={openMenu === 'block'}
        aria-controls={openMenu === 'block' ? menuId : undefined}
        title={t('addBlockShortcut')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openBlocks}
      >
        <Plus size={17} aria-hidden="true" />
        <span>{t('addBlock')}</span>
      </button>
      <span className="writer-toolbar-divider" aria-hidden="true" />
      {formats.map(({ key, icon: Icon, active, apply }) => (
        <button
          key={key}
          type="button"
          className="writer-icon-button"
          aria-label={t(key)}
          aria-pressed={active}
          title={t(key)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={apply}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
      <span className="writer-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="writer-icon-button"
        aria-label={t('insertPageLink')}
        aria-expanded={openMenu === 'page'}
        aria-controls={openMenu === 'page' ? menuId : undefined}
        title={t('insertPageLinkShortcut')}
        disabled={!marks.canLink}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPageLinks}
      >
        <Link2 size={17} aria-hidden="true" />
      </button>
      {children}
    </div>
  )
}
