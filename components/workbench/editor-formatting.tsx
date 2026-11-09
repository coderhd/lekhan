'use client'

import { useEffect, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Editor } from '@tiptap/react'
import styles from './editor.module.css'
import overlay from './overlays.module.css'

/** Disclose the existing full command set while leaving the live editor mounted. */
export default function EditorFormatting({ editor, onLink, disabled, children }: {
 editor: Editor
 onLink: () => void
 disabled: boolean
 children: ReactNode
}) {
 const [narrow, setNarrow] = useState(false)
 const [open, setOpen] = useState(false)
 useEffect(() => {
  const media = window.matchMedia('(max-width: 767px)')
  const update = () => { setNarrow(media.matches); if (!media.matches) setOpen(false) }
  update()
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
 }, [])
 if (!narrow) return <div role="toolbar" aria-label="Page formatting" className={styles.toolbar} aria-disabled={disabled} inert={disabled}>{children}</div>
 return <div role="toolbar" aria-label="Page formatting" className={styles.toolbar} aria-disabled={disabled} inert={disabled}>
  <button type="button" aria-label="Bold" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
  <button type="button" aria-label="Italic" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
  <button type="button" aria-label="Strikethrough" aria-pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
  <button type="button" aria-label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>≡</button>
  <button type="button" aria-label="Insert link" onClick={onLink}>Link</button>
  <Dialog.Root open={open} onOpenChange={setOpen}>
   <Dialog.Trigger asChild><button type="button" aria-label="More formatting actions">•••</button></Dialog.Trigger>
   <Dialog.Portal>
    <Dialog.Overlay className={`${overlay.scrim} ${styles.formattingScrim}`} />
    <Dialog.Content className={`${overlay.sheet} ${styles.formattingSheet}`}>
     <div className={overlay.heading}><Dialog.Title>More formatting</Dialog.Title><Dialog.Close aria-label="Close formatting">✕</Dialog.Close></div>
     <Dialog.Description className="sr-only">All page formatting commands.</Dialog.Description>
     <div className={styles.toolbar}>{children}</div>
    </Dialog.Content>
   </Dialog.Portal>
  </Dialog.Root>
 </div>
}
