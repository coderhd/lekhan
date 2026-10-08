import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import EditorWorkspace from '../../components/editor-workspace'
import GlobalSearchPalette from '../../components/global-search-palette'
import * as Y from 'yjs'

// ---------------------------------------------------------------------------
// Seam 3 — clipboard paste through the live Tiptap editor. Exercises the
// Obsidian frontmatter path end to end: frontmatter-only notes (no body HTML)
// must still land their properties instead of pasting raw YAML, and the body
// insert must not be deferred behind the asynchronous properties RPC.
// ---------------------------------------------------------------------------

const updatePagePropertiesMock = vi.fn()

vi.mock('../../components/session-reauth-provider', () => ({
	useSessionReauth: () => ({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() }),
}))

const mockDoc = new Y.Doc()
vi.mock('@/hooks/use-editor-collab', () => ({
	useEditorCollab: () => ({
		ydoc: mockDoc,
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

afterEach(() => {
	cleanup()
	updatePagePropertiesMock.mockReset()
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

	it('inserts the pasted body without waiting for the properties RPC to resolve', async () => {
		// Simulate an in-flight RPC that never resolves during this test: under a
		// deferred insert the body would be missing, and typing meanwhile would be
		// clobbered by replaceDocument.
		let resolveRpc: (() => void) | undefined
		updatePagePropertiesMock.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveRpc = resolve
			}),
		)
		renderEditor()
		const proseMirror = await getProseMirror()

		dispatchPaste(proseMirror, '---\nstatus: active\n---\n\n# Body heading\n', '')

		await waitFor(() => expect(proseMirror.textContent ?? '').toContain('Body heading'))
		expect(updatePagePropertiesMock).toHaveBeenCalledWith('page-1', { status: 'active' })
		resolveRpc?.()
	})
})
