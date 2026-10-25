import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import EditorWorkspace from '../../components/editor-workspace'
import GlobalSearchPalette from '../../components/global-search-palette'
import * as Y from 'yjs'

// ---------------------------------------------------------------------------
// T2 of #30 — public reading surface for anonymous visitors. A signed-out
// visitor on a shared public page (`anonVisitor`) must get a reader surface:
// a Public badge, a shared-link banner, a footer signup CTA — and none of the
// collaborator chrome (search, history, AI settings, profile menu, sync
// indicator). The theme toggle remains available on mobile as well. Member
// viewers and editors keep the collaborator workspace.
// ---------------------------------------------------------------------------

const captured = vi.hoisted(() => ({
	doc: null as Y.Doc | null,
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

const memberRole = vi.hoisted(() => ({ value: 'owner' as string | null }))

vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false, properties: {} }),
	fetchPageMemberRole: vi.fn().mockImplementation(() => Promise.resolve(memberRole.value)),
	updatePageTitle: vi.fn().mockResolvedValue(true),
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

interface RenderOpts {
	anonVisitor: boolean
	role: string | null
	userId?: string
}

async function renderEditor ({ anonVisitor, role, userId = 'test-user' }: RenderOpts) {
	memberRole.value = role
	render(
		<GlobalSearchPalette>
			<EditorWorkspace
				pageId="page-1"
				initialTitle="Shared Page"
				token={anonVisitor ? 'anonymous' : 'token-1'}
				currentUser={{ id: userId, email: `${userId}@example.com`, full_name: anonVisitor ? 'Anonymous Viewer' : 'Test User' }}
				anonVisitor={anonVisitor}
			/>
		</GlobalSearchPalette>,
	)
	await waitFor(() => {
		expect(document.querySelector('.ProseMirror')).toBeTruthy()
	})
}

describe('EditorWorkspace public reading chrome (#30 T2)', () => {
	beforeEach(() => {
		captured.doc = new Y.Doc()
	})

	afterEach(() => {
		cleanup()
	})

	it('anon visitor sees the reading surface, not collaborator chrome', async () => {
		await renderEditor({ anonVisitor: true, role: null, userId: 'anon-1234' })

		expect(await screen.findByText('Public')).toBeInTheDocument()
		expect(await screen.findByText(/Anyone with the link can view this page\./)).toBeInTheDocument()
		expect(screen.getByRole('link', { name: /create your own workspace/i })).toHaveAttribute('href', '/signup')

		expect(screen.queryByText(/You have viewing access/)).toBeNull()

		// Theme control stays for the reader — including on mobile, where it is
		// otherwise md-gated for members.
		await waitFor(() => {
			expect(screen.getByTitle(/Switch to (Light|Dark) Mode/)).toBeTruthy()
		})

		expect(screen.queryByTitle('Search (Cmd+K)')).toBeNull()
		expect(screen.queryByTitle('Version History')).toBeNull()
		expect(screen.queryByTitle('Settings')).toBeNull()
		expect(screen.queryByLabelText(/Account menu/)).toBeNull()
		expect(screen.queryByText('Share')).toBeNull()
	})

	it('member viewer keeps collaborator chrome and gets the viewing-access banner', async () => {
		// Member is not the owner (owner_id is mocked to 'test-user').
		await renderEditor({ anonVisitor: false, role: 'viewer', userId: 'member-5678' })

		expect(await screen.findByText(/You have viewing access to this page\./)).toBeInTheDocument()
		expect(screen.getByTitle('Search (Cmd+K)')).toBeInTheDocument()
		expect(screen.getByLabelText(/Account menu/)).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /create your own workspace/i })).toBeNull()
	})

	it('editor gets the full workspace without the reading chrome', async () => {
		await renderEditor({ anonVisitor: false, role: 'owner' })

		expect(await screen.findByText('Share')).toBeInTheDocument()
		expect(screen.queryByText(/Anyone with the link can view this page\./)).toBeNull()
		expect(screen.queryByRole('link', { name: /create your own workspace/i })).toBeNull()
	})
})
