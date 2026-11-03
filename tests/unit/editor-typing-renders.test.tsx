import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { Profiler } from 'react'
import '@testing-library/jest-dom'

/**
 * SIL-230 / #144 — typing must not re-render the editor workspace once per
 * character.
 *
 * Root cause: `yCursorPlugin` writes the local awareness `cursor` field on
 * every view update, which during typing is every keystroke. `useEditorCollab`
 * turned every awareness `change` into a fresh `activeUsers` array, so the
 * whole workspace — header, toolbar, every dropdown scope — committed again
 * per character (audit: 7,285 React renders over a 38-char burst).
 *
 * This test mounts the real `EditorWorkspace`, real Tiptap editor and real
 * `useEditorCollab`, with only the transport providers replaced by in-memory
 * fakes. It focuses the editor (jsdom otherwise hides the cursor plugin's
 * per-keystroke awareness writes) and types 38 characters. The awareness
 * counter proves the storm mechanism actually fired; the commit count proves
 * the workspace no longer follows it.
 */

const captured = vi.hoisted(() => ({
	editor: null as any,
	awarenessSets: 0,
	changeEvents: 0,
}))

vi.mock('@tiptap/react', async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		useEditor: (...args: any[]) => {
			const editor = actual.useEditor(...args)
			if (editor) captured.editor = editor
			return editor
		},
	}
})

vi.mock('y-websocket', () => {
	class FakeWebsocketProvider {
		awareness: any
		constructor(public url: string, public room: string, public doc: any, public opts: any) {
			const listeners: Record<string, Array<() => void>> = {}
			let local: any = {}
			const states = new Map<string, any>([['local', { user: { id: 'u1', name: 'User', color: '#ffffff' } }]])
			this.awareness = {
				setLocalStateField: (field: string, value: any) => {
					captured.awarenessSets++
					local = { ...local, [field]: value }
					states.set('local', local)
					for (const fn of listeners.change ?? []) {
						captured.changeEvents++
						fn()
					}
				},
				on: (event: string, fn: () => void) => { (listeners[event] ??= []).push(fn) },
				off: (event: string, fn: () => void) => { listeners[event] = (listeners[event] ?? []).filter(f => f !== fn) },
				getStates: () => states,
				getLocalState: () => local,
				setLocalState: vi.fn(),
			}
		}
		on() {}
		destroy() {}
	}
	return { WebsocketProvider: FakeWebsocketProvider }
})

vi.mock('y-indexeddb', () => {
	class FakeIndexeddbPersistence {
		constructor(public name: string, public doc: any) {}
		on(event: string, cb: () => void) { if (event === 'synced') setTimeout(cb, 0) }
		destroy() {}
	}
	return { IndexeddbPersistence: FakeIndexeddbPersistence }
})

vi.mock('../../components/session-reauth-provider', () => ({
	useSessionReauth: () => ({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
			getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
		},
	},
}))

vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false, properties: {} }),
	fetchPageMemberRole: vi.fn().mockResolvedValue('owner'),
	updatePageTitle: vi.fn().mockResolvedValue(true),
	fetchMentionablePageCollaborators: vi.fn().mockResolvedValue([]),
	fetchPageTags: vi.fn().mockResolvedValue([]),
	fetchWorkspacePages: vi.fn().mockResolvedValue([]),
	fetchPageBacklinks: vi.fn().mockResolvedValue([]),
	createPage: vi.fn(),
}))

vi.mock('@/services/db', () => ({
	getUserAICredits: vi.fn().mockResolvedValue({ plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('EditorWorkspace typing render budget (SIL-230)', () => {
	beforeEach(() => {
		captured.editor = null
		captured.awarenessSets = 0
		captured.changeEvents = 0
	})
	afterEach(() => cleanup())

	it('does not commit the workspace once per keystroke', async () => {		const EditorWorkspace = (await import('../../components/editor-workspace')).default
		const GlobalSearchPalette = (await import('../../components/global-search-palette')).default

		let commits = 0
		render(
			<Profiler id='workspace' onRender={() => { commits++ }}>
				<GlobalSearchPalette>
					<EditorWorkspace
						pageId='page-1'
						initialTitle='Typing benchmark'
						token='token-1'
						currentUser={{ id: 'test-user', email: 'test-user@example.com', full_name: 'Test User' }}
					/>
				</GlobalSearchPalette>
			</Profiler>,
		)
		await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy(), { timeout: 5000 })
		await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

		const pm = document.querySelector('.ProseMirror') as HTMLElement
		act(() => {
			pm.focus()
			pm.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
		})
		await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

		const baseline = commits
		captured.awarenessSets = 0
		captured.changeEvents = 0
		const editor = captured.editor
		expect(editor).toBeTruthy()

		const KEYS = 38
		for (let i = 0; i < KEYS; i++) {
			act(() => { editor.commands.insertContent('a') })
		}
		await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

		// The cursor plugin did fire per keystroke — otherwise this test is not
		// exercising the regression it claims to guard.
		expect(captured.awarenessSets).toBeGreaterThanOrEqual(KEYS)
		expect(captured.changeEvents).toBeGreaterThanOrEqual(KEYS)

		// One initial dirty-flag commit and one initial presence commit may
		// land, but nothing scales with the number of characters. A regression
		// to per-keystroke commits would be ~KEYS (38).
		expect(commits - baseline).toBeLessThanOrEqual(4)
	}, 15000)
})
