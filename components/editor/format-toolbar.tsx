import { type Editor, useEditorState } from '@tiptap/react'
import { Bold, Code2, Italic, Link2, Plus, Strikethrough } from 'lucide-react'

interface FormatToolbarProps {
  editor: Editor
  openBlocks: () => void
  openPageLinks: () => void
  openMenu: 'block' | 'page' | undefined
  menuId: string
}

export function FormatToolbar({ editor, openBlocks, openPageLinks, openMenu, menuId }: FormatToolbarProps) {
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
    { label: 'Bold', icon: Bold, active: marks.bold, apply: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: marks.italic, apply: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', icon: Strikethrough, active: marks.strike, apply: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Inline code', icon: Code2, active: marks.code, apply: () => editor.chain().focus().toggleCode().run() },
  ]

  return (
    <div className="writer-toolbar" role="group" aria-label="Page formatting">
      <button
        type="button"
        className="writer-icon-button writer-add-block"
        aria-label="Add block"
        aria-expanded={openMenu === 'block'}
        aria-controls={openMenu === 'block' ? menuId : undefined}
        title="Add block (/)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={openBlocks}
      >
        <Plus size={17} aria-hidden="true" />
        <span>Add block</span>
      </button>
      <span className="writer-toolbar-divider" aria-hidden="true" />
      {formats.map(({ label, icon: Icon, active, apply }) => (
        <button
          key={label}
          type="button"
          className="writer-icon-button"
          aria-label={label}
          aria-pressed={active}
          title={label}
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
        aria-label="Insert page link"
        aria-expanded={openMenu === 'page'}
        aria-controls={openMenu === 'page' ? menuId : undefined}
        title="Insert page link ([[)"
        disabled={!marks.canLink}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPageLinks}
      >
        <Link2 size={17} aria-hidden="true" />
      </button>
    </div>
  )
}
