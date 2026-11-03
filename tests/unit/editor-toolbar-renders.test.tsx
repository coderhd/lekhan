import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler, memo, useLayoutEffect } from 'react'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { EditorToolbar } from '../../components/editor-toolbar'
import { getSharedExtensions } from '../../lib/editor-extensions'

/**
 * SIL-230 / #144 — the formatting toolbar must not re-render on every
 * keystroke. It used to be inline JSX inside `EditorWorkspace`, so any
 * workspace state change (presence/cursor awareness churn included) recursed
 * through the toolbar and its dropdown scopes, once per character.
 */

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

const openLinkPrompt = () => {}

let toolbarCommits = 0
let wrapperRenders = 0

// A memo boundary in front of the real toolbar, so the test can tell a
// parent-driven render (the wrapper would re-run) from an internal
// `useEditorState` commit (only the Profiler fires).
const CountedToolbar = memo(function CountedToolbar ({ editor }: { editor: Editor | null }) {
	wrapperRenders++
	return (
		<Profiler id='toolbar' onRender={() => { toolbarCommits++ }}>
			<EditorToolbar editor={editor} onOpenLinkPrompt={openLinkPrompt} />
		</Profiler>
	)
})

function Harness ({ onReady }: { onReady: (editor: Editor) => void }) {
	const editor = useEditor({ extensions: getSharedExtensions(), immediatelyRender: false })

	useLayoutEffect(() => {
		if (editor) onReady(editor)
	}, [editor, onReady])

	return (
		<div>
			<CountedToolbar editor={editor} />
			<EditorContent editor={editor} />
		</div>
	)
}

describe('EditorToolbar render budget', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		toolbarCommits = 0
		wrapperRenders = 0
	})
	afterEach(() => cleanup())

	async function mount () {
		let editor: Editor | null = null
		render(<Harness onReady={(instance) => { editor = instance }} />)
		await waitFor(() => expect(editor).toBeTruthy())
		const pm = document.querySelector('.ProseMirror') as HTMLElement
		act(() => { pm.focus(); pm.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
		return {
			get editor () { return editor as unknown as Editor },
			baselineCommits: toolbarCommits,
			baselineWrapper: wrapperRenders,
		}
	}

	it('does not render the toolbar for a 38-character typing burst', async () => {
		const harness = await mount()
		for (let i = 0; i < 38; i++) {
			act(() => { harness.editor.commands.insertContent('a') })
		}
		expect(toolbarCommits - harness.baselineCommits).toBe(0)
		expect(wrapperRenders).toBe(harness.baselineWrapper)
	}, 30000)

	it('keeps the production memo boundary', () => {
		// The harness's own memo wrapper is not the production boundary; if
		// someone dropped `memo()` from EditorToolbar this assertion fails.
		expect((EditorToolbar as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
	})

	it('does not light Align Left by default (parity with the inline toolbar)', async () => {
		await mount()
		expect(document.querySelector('button[title="Align Left"]')).not.toHaveClass('text-primary')
	}, 30000)

	it('still renders when the active formatting changes', async () => {
		const harness = await mount()
		expect(toolbarCommits - harness.baselineCommits).toBe(0)

		act(() => { harness.editor.chain().focus().toggleBold().run() })

		expect(toolbarCommits - harness.baselineCommits).toBeGreaterThan(0)
		expect(document.querySelector('button[title="Bold"]')).toHaveClass('text-primary')
	}, 30000)
})
