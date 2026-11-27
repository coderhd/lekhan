'use client'

import type { ReactNode } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { Bold, Code2, Italic, Link2, Plus, Strikethrough } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { IconButton } from '@astryxdesign/core/IconButton'
import { HStack } from '@astryxdesign/core/Stack'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
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
    <HStack gap={1} align="center" wrap="wrap" className="writer-toolbar" role="group" aria-label={t('formatting')}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={<Plus size={16} aria-hidden="true" />}
        label={t('addBlock')}
        tooltip={t('addBlockShortcut')}
        aria-expanded={openMenu === 'block'}
        aria-controls={openMenu === 'block' ? menuId : undefined}
        onMouseDown={event => event.preventDefault()}
        onClick={openBlocks}
      />
      <Divider orientation="vertical" />
      {formats.map(({ key, icon: Icon, active, apply }) => (
        <ToggleButton
          key={key}
          label={t(key)}
          tooltip={t(key)}
          isIconOnly
          size="sm"
          isPressed={active}
          icon={<Icon size={16} aria-hidden="true" />}
          onMouseDown={event => event.preventDefault()}
          onClick={apply}
        />
      ))}
      <Divider orientation="vertical" />
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        label={t('insertPageLink')}
        tooltip={t('insertPageLinkShortcut')}
        aria-expanded={openMenu === 'page'}
        aria-controls={openMenu === 'page' ? menuId : undefined}
        isDisabled={!marks.canLink}
        icon={<Link2 size={17} aria-hidden="true" />}
        onMouseDown={event => event.preventDefault()}
        onClick={openPageLinks}
      />
      {children}
    </HStack>
  )
}
