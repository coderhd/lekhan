import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler, memo, useEffect, useLayoutEffect, useState } from 'react'
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react'
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

function Harness ({ onReady, onParentRender }: { onReady: (editor: Editor) => void; onParentRender?: () => void }) {
	const editor = useEditor({ extensions: getSharedExtensions(), immediatelyRender: false })
	const [tick, setTick] = useState(0)

	useLayoutEffect(() => {
		if (editor) onReady(editor)
	}, [editor, onReady])

	useEffect(() => {
		onParentRender?.()
	})

	return (
		<div>
			<button type='button' onClick={() => setTick((value) => value + 1)} data-testid='parent-rerender'>
				{tick}
			</button>
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

	async function mount (onParentRender?: () => void) {
		let editor: Editor | null = null
		render(<Harness onReady={(instance) => { editor = instance }} onParentRender={onParentRender} />)
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
	})

	it('does not render the toolbar when unrelated parent state changes', async () => {
		let parentRenders = 0
		const harness = await mount(() => { parentRenders++ })
		for (let i = 0; i < 5; i++) {
			fireEvent.click(document.querySelector('[data-testid="parent-rerender"]') as HTMLElement)
		}
		expect(parentRenders).toBeGreaterThan(5)
		expect(wrapperRenders).toBe(harness.baselineWrapper)
	})

	it('still renders when the active formatting changes', async () => {
		const harness = await mount()
		expect(toolbarCommits - harness.baselineCommits).toBe(0)

		act(() => { harness.editor.chain().focus().toggleBold().run() })

		expect(toolbarCommits - harness.baselineCommits).toBeGreaterThan(0)
		expect(document.querySelector('button[title="Bold"]')).toHaveClass('text-primary')
	})
})
