import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLayoutEffect } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import AIBubbleMenu from '../../components/ai-bubble-menu'
import { getSharedExtensions } from '../../lib/editor-extensions'

/**
 * CodeRabbit #202 finding: deduplicating `setPos` must not freeze the mark
 * UI. Position and mark state are independent — a keyboard shortcut can toggle
 * bold without moving the selection, and the buttons still have to repaint.
 * (The code-block language select uses the same `useEditorState` fix; it is
 * not unit-tested here because jsdom's selection/DOM timing makes the
 * decoration mount nondeterministic.)
 */

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

function Harness ({ onReady }: { onReady: (editor: Editor) => void }) {
	const editor = useEditor({ extensions: getSharedExtensions(), immediatelyRender: false })

	useLayoutEffect(() => {
		if (editor) {
			// jsdom has no layout; keep coordinates stable so the only thing
			// that can change the rendered control is the mark/language state.
			vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 } as any)
			onReady(editor)
		}
	}, [editor, onReady])

	return (
		<div className='editor-canvas'>
			<AIBubbleMenu editor={editor} onOpenLekhanBot={() => {}} />
			<EditorContent editor={editor} />
		</div>
	)
}

describe('editor decorations react to content changes (SIL-230)', () => {
	beforeEach(() => { vi.restoreAllMocks() })
	afterEach(() => cleanup())

	async function mount () {
		let editor: Editor | null = null
		render(<Harness onReady={(instance) => { editor = instance }} />)
		await waitFor(() => expect(editor).toBeTruthy())
		return { get editor () { return editor as unknown as Editor } }
	}

	it('repaints bubble-menu marks when the mark changes but the selection does not move', async () => {
		const harness = await mount()
		act(() => {
			harness.editor.commands.setContent('<p>hello world</p>')
			harness.editor.commands.selectAll()
		})

		const bold = await waitFor(() => {
			const button = document.querySelector('button[title="Bold"]')
			expect(button).toBeTruthy()
			return button as HTMLElement
		})
		expect(bold.className).not.toContain('bg-primary/20')

		act(() => { harness.editor.chain().focus().toggleBold().run() })

		await waitFor(() => expect(bold.className).toContain('bg-primary/20'))
	})

})
