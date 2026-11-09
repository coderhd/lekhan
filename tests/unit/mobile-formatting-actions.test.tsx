import '@testing-library/jest-dom'
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import EditorFormatting from '@/components/workbench/editor-formatting'
import { ColorHighlightPopover } from '@/components/color-highlight-popover'
import { CustomSelect } from '@/components/ui/custom-select'
import { PromptDialog } from '@/components/ui/prompt-dialog'

function Formatting({ editor }: { editor: Editor }) {
 const [linkOpen, setLinkOpen] = useState(false)
 return <>
  <EditorContent editor={editor} />
  <EditorFormatting editor={editor} disabled={false} onLink={() => setLinkOpen(true)}>
   <CustomSelect modal value="p" options={[{ label: 'Paragraph', value: 'p' }, { label: 'Heading 2', value: 'h2' }]} onValueChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
   <ColorHighlightPopover editor={editor} />
   <button onClick={() => setLinkOpen(true)}>Link</button>
  </EditorFormatting>
  <PromptDialog open={linkOpen} onOpenChange={setLinkOpen} title="Add Link" description="Enter a link URL" placeholder="https://example.com" onSubmit={href => editor.chain().focus().setLink({ href }).run()} />
 </>
}

describe('Mobile full formatting actions', () => {
 let editor: Editor
 beforeEach(() => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, media: '(max-width: 767px)', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })
  // JSDOM has no selection geometry. Keep actual editing commands; skip scrolling.
  editor = new Editor({ extensions: [StarterKit, TextStyle, Color, Highlight.configure({ multicolor: true })], content: '<p>Selected writing</p>', editorProps: { handleScrollToSelection: () => true } })
  editor.commands.setTextSelection({ from: 1, to: 9 })
 })
 afterEach(() => { cleanup(); editor.destroy(); vi.mocked(window.matchMedia).mockReturnValue({ matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }) })

 it('applies a color from the nested menu to the live selection', async () => {
  render(<Formatting editor={editor} />)
  fireEvent.click(screen.getByRole('button', { name: 'More formatting actions' }))
  const dialog = screen.getByRole('dialog', { name: 'More formatting' })
  const colors = within(dialog).getByTitle('Text Color & Highlight')
  colors.focus()
  fireEvent.keyDown(colors, { key: 'ArrowDown' })
  const colorMenu = await screen.findByRole('menu')
  fireEvent.click(within(colorMenu).getAllByRole('menuitem', { name: /Blue/ })[0])
  await waitFor(() => expect(editor.getHTML()).toContain('--text-blue'))
 })

 it('applies a heading from the nested menu to the live selection', async () => {
  render(<Formatting editor={editor} />)
  fireEvent.click(screen.getByRole('button', { name: 'More formatting actions' }))
  const dialog = screen.getByRole('dialog', { name: 'More formatting' })
  const heading = within(dialog).getByRole('button', { name: 'Paragraph' })
  heading.focus()
  fireEvent.keyDown(heading, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Heading 2' }))
  await waitFor(() => expect(editor.getHTML()).toContain('<h2>'))
 })

 it('submits a link prompt from full formatting without replacing the editor', async () => {
  render(<Formatting editor={editor} />)
  const writing = document.querySelector('.ProseMirror')
  fireEvent.click(screen.getByRole('button', { name: 'More formatting actions' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'More formatting' })).getByRole('button', { name: 'Link' }))
  const prompt = screen.getByRole('alertdialog', { name: 'Add Link' })
  fireEvent.change(within(prompt).getByPlaceholderText('https://example.com'), { target: { value: 'https://example.com/writing' } })
  await act(async () => fireEvent.click(within(prompt).getByRole('button', { name: 'Submit' })))
  expect(editor.getHTML()).toContain('href="https://example.com/writing"')
  expect(document.querySelector('.ProseMirror')).toBe(writing)
 })
})
