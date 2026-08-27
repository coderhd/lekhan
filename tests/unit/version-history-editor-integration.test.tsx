import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditorWorkspace from '../../components/editor-workspace'
import GlobalSearchPalette from '../../components/global-search-palette'
import * as Y from 'yjs'
import { VersionHistoryEngine } from '../../lib/version-history/engine'
import { IndexedDBHistoryAdapter } from '../../lib/version-history/adapters/indexeddb'
import { toast } from 'sonner'

// Mock toast
vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	}
}))

vi.mock('../../components/session-reauth-provider', () => ({
	useSessionReauth: () => ({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() }),
}))

const mockDoc = new Y.Doc()
let mockHasUnsyncedChanges = true

vi.mock('@/hooks/use-editor-collab', () => ({
	useEditorCollab: () => {
		return {
			ydoc: mockDoc,
			isConnected: true,
			isSynced: true,
			connectionState: 'connected',
			isOffline: false,
			activeUsers: [],
			hasUnsyncedChanges: mockHasUnsyncedChanges,
			provider: null,
			isLocalSynced: true
		}
	}
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getUser: vi.fn(),
			getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
		}
	}
}))

vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false, workspace_id: 'w-1' }),
	fetchPageMemberRole: vi.fn().mockResolvedValue('owner'),
	updatePageTitle: vi.fn().mockResolvedValue(true),
	fetchMentionablePageCollaborators: vi.fn().mockResolvedValue([]),
	fetchWorkspacePages: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/db', () => ({
	getUserAICredits: vi.fn().mockResolvedValue({ plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }),
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({
		push: vi.fn(),
	})
}))

vi.mock('../../lib/version-history/adapters/indexeddb', () => {
	return {
		IndexedDBHistoryAdapter: vi.fn().mockImplementation(() => {
			return {}
		})
	}
})

vi.mock('../../lib/version-history/engine', () => {
	return {
		VersionHistoryEngine: vi.fn().mockImplementation(() => {
			return {
				createAutoCheckpoint: vi.fn().mockResolvedValue({}),
				listVersions: vi.fn().mockResolvedValue([]),
				getSnapshotText: vi.fn().mockResolvedValue(''),
			}
		})
	}
})

describe('VersionHistory Editor Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockHasUnsyncedChanges = true
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it('should open and close the version history drawer when clicking the header button', async () => {
		const mockUser = { id: 'test-user', email: 'test@example.com', full_name: 'Test User' }
		render(
			<GlobalSearchPalette>
				<EditorWorkspace pageId="page-1" initialTitle="Test Doc" token="token-1" currentUser={mockUser} />
			</GlobalSearchPalette>
		)

		await screen.findByTitle('Version History')
		const historyBtn = screen.getByTitle('Version History')
		fireEvent.click(historyBtn)

		expect(await screen.findByText('Version History')).toBeDefined()
	})

	it('should open the version history drawer with Cmd+Shift+S', async () => {
		const mockUser = { id: 'test-user', email: 'test@example.com', full_name: 'Test User' }
		render(
			<GlobalSearchPalette>
				<EditorWorkspace pageId="page-1" initialTitle="Test Doc" token="token-1" currentUser={mockUser} />
			</GlobalSearchPalette>
		)

		expect(screen.queryByText('Version History')).toBeNull()
		fireEvent.keyDown(document, { key: 's', metaKey: true, shiftKey: true })

		expect(await screen.findByText('Version History')).toBeDefined()
	})

	it('should trigger auto-checkpoint every 15 minutes if there are unsynced changes', async () => {
		vi.useFakeTimers()
		const mockUser = { id: 'test-user', email: 'test@example.com', full_name: 'Test User' }
		render(
			<GlobalSearchPalette>
				<EditorWorkspace pageId="page-1" initialTitle="Test Doc" token="token-1" currentUser={mockUser} />
			</GlobalSearchPalette>
		)

		await vi.advanceTimersByTimeAsync(900000)

		const engineInstance = vi.mocked(VersionHistoryEngine).mock.results[0].value
		expect(engineInstance.createAutoCheckpoint).toHaveBeenCalled()
		vi.useRealTimers()
	})

	it('should NOT trigger auto-checkpoint if no unsynced changes', async () => {
		vi.useFakeTimers()
		mockHasUnsyncedChanges = false
		const mockUser = { id: 'test-user', email: 'test@example.com', full_name: 'Test User' }
		render(
			<GlobalSearchPalette>
				<EditorWorkspace pageId="page-1" initialTitle="Test Doc" token="token-1" currentUser={mockUser} />
			</GlobalSearchPalette>
		)

		await vi.advanceTimersByTimeAsync(900000)

		const engineInstance = vi.mocked(VersionHistoryEngine).mock.results[0].value
		expect(engineInstance.createAutoCheckpoint).not.toHaveBeenCalled()
		vi.useRealTimers()
	})
})
