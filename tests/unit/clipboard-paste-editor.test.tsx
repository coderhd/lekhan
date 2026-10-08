import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import EditorWorkspace from '../../components/editor-workspace'
import GlobalSearchPalette from '../../components/global-search-palette'
import * as Y from 'yjs'

// ---------------------------------------------------------------------------
// Seam 3 — clipboard paste through the live Tiptap editor. Exercises the
// Obsidian frontmatter path end to end: a frontmatter-only note must land its
// properties instead of pasting raw YAML, the body must be inserted only after
// the properties RPC settles (so the debounced graph index reads them), and
// edits typed while that RPC is in flight must never be clobbered.
// ---------------------------------------------------------------------------

const updatePagePropertiesMock = vi.fn()

// Capture the live editor instance so a test can simulate a user editing the
// document while the asynchronous properties RPC is still pending. The Y.Doc is
// recreated before each test so collaboration content never leaks between them.
const captured = vi.hoisted(() => ({
	editor: null as { commands: { insertContent: (content: string) => void } } | null,
	doc: null as InstanceType<typeof import('yjs').Doc> | null,
}))

vi.mock('../../components/session-reauth-provider', () => ({
	useSessionReauth: () => ({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() }),
}))

vi.mock('@/hooks/use-editor-collab', () => ({
	useEditorCollab: () => ({
		ydoc: captured.doc,
		isConnected: true,
		isSynced: true,
		connectionState: 'connected',
		isOffline: false,
		activeUsers: [],
		hasUnsyncedChanges: false,
		provider: null,
		isLocalSynced: true,
	}),
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
	updatePageProperties: (...args: unknown[]) => updatePagePropertiesMock(...args),
	fetchMentionablePageCollaborators: vi.fn().mockResolvedValue([]),
	fetchPageTags: vi.fn().mockResolvedValue([]),
	fetchWorkspacePages: vi.fn().mockResolvedValue([]),
	createPage: vi.fn(),
}))

vi.mock('@/services/db', () => ({
	getUserAICredits: vi.fn().mockResolvedValue({
		plan: 'free',
		totalAllocated: 50,
		usedCredits: 0,
		remainingCredits: 50,
	}),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@tiptap/react', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tiptap/react')>()
	return {
		...actual,
		useEditor(options: Parameters<typeof actual.useEditor>[0]) {
			const editor = actual.useEditor(options)
			captured.editor = editor as unknown as typeof captured.editor
			return editor
		},
	}
})

function renderEditor() {
	return render(
		<GlobalSearchPalette>
			<EditorWorkspace
				pageId="page-1"
				initialTitle="Test Doc"
				token="token-1"
				currentUser={{ id: 'test-user', email: 'test@example.com' }}
			/>
		</GlobalSearchPalette>,
	)
}

async function getProseMirror(): Promise<HTMLElement> {
	let el: HTMLElement | null = null
	await waitFor(() => {
		el = document.querySelector('.ProseMirror')
		expect(el).toBeTruthy()
	})
	return el as unknown as HTMLElement
}

function dispatchPaste(el: HTMLElement, plain: string, html: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true })
	Object.defineProperty(event, 'clipboardData', {
		value: {
			getData: (type: string) => (type === 'text/plain' ? plain : type === 'text/html' ? html : ''),
		},
	})
	el.dispatchEvent(event)
}

beforeEach(() => {
	captured.doc = new Y.Doc()
})

afterEach(() => {
	cleanup()
	updatePagePropertiesMock.mockReset()
	captured.editor = null
	captured.doc?.destroy()
	captured.doc = null
})

describe('Obsidian paste through the live editor', () => {
	it('applies frontmatter properties and never pastes raw YAML for a frontmatter-only note', async () => {
		updatePagePropertiesMock.mockResolvedValue(undefined)
		renderEditor()
		const proseMirror = await getProseMirror()

		dispatchPaste(proseMirror, '---\nstatus: active\ntags:\n  - work\n---\n', '')

		await waitFor(() => expect(updatePagePropertiesMock).toHaveBeenCalledTimes(1))
		expect(updatePagePropertiesMock).toHaveBeenCalledWith('page-1', {
			status: 'active',
			tags: ['work'],
		})
		// The raw YAML/keys must not have fallen through to the native paste.
		expect(proseMirror.textContent ?? '').not.toContain('status: active')
		expect(proseMirror.textContent ?? '').not.toContain('---')
	})

	it('waits for the properties RPC before inserting the body so the index reads them', async () => {
		let resolveRpc: (() => void) | undefined
		updatePagePropertiesMock.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveRpc = resolve
			}),
		)
		renderEditor()
		const proseMirror = await getProseMirror()

		dispatchPaste(proseMirror, '---\nstatus: active\n---\n\n# Body heading\n', '')

		await waitFor(() => expect(updatePagePropertiesMock).toHaveBeenCalledWith('page-1', { status: 'active' }))
		// Properties are persisted before the body lands, so the debounced
		// save/index triggered by the insert reads the fresh properties.
		expect(proseMirror.textContent ?? '').not.toContain('Body heading')

		resolveRpc?.()
		await waitFor(() => expect(proseMirror.textContent ?? '').toContain('Body heading'))
	})

	it('does not clobber edits typed while the properties RPC is in flight', async () => {
		let resolveRpc: (() => void) | undefined
		updatePagePropertiesMock.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveRpc = resolve
			}),
		)
		renderEditor()
		const proseMirror = await getProseMirror()

		dispatchPaste(proseMirror, '---\nstatus: active\n---\n\n# Pasted heading\n', '')
		await waitFor(() => expect(updatePagePropertiesMock).toHaveBeenCalled())

		// Simulate the user typing while the RPC is still pending (empty doc at
		// paste time means the deferred apply would otherwise replace the whole
		// document and discard this edit).
		captured.editor?.commands.insertContent('typed while pending')

		resolveRpc?.()
		await waitFor(() => expect(proseMirror.textContent ?? '').toContain('Pasted heading'))
		expect(proseMirror.textContent ?? '').toContain('typed while pending')
	})
})
