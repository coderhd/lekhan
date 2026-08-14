import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorWorkspace from '../../components/editor-workspace'
import * as Y from 'yjs'

// Mock the hook to avoid actual websocket connections during test
const mockDoc = new Y.Doc()
vi.mock('@/hooks/use-editor-collab', () => ({
	useEditorCollab: () => {
		return {
			ydoc: mockDoc,
			isConnected: true,
			isSynced: true,
			connectionState: 'connected',
			isOffline: false,
			activeUsers: [],
			hasUnsyncedChanges: false,
			provider: null,
			isLocalSynced: true
		}
	}
}))

// Mock supabase client
vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getUser: vi.fn(),
		}
	}
}))

vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false }),
	fetchPageMemberRole: vi.fn().mockResolvedValue('owner'),
	updatePageTitle: vi.fn().mockResolvedValue(true),
	fetchMentionablePageCollaborators: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/db', () => ({
	getUserAICredits: vi.fn().mockResolvedValue({ plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }),
}))

// Mock useRouter
vi.mock('next/navigation', () => ({
	useRouter: () => ({
		push: vi.fn(),
	})
}))

describe('EditorWorkspace Formatting', () => {
	it('should render the formatting toolbar buttons', async () => {
		const mockUser = { id: 'test-user', email: 'test@example.com' }
		
		render(
			<EditorWorkspace 
pageId="page-1" 
			initialTitle="Test Doc"
				token="token-1" 
				currentUser={mockUser} 
			/>
		)

		expect(await screen.findByTitle('Bold')).toBeDefined()
		expect(await screen.findByTitle('Italic')).toBeDefined()
		expect(await screen.findByTitle('Bullet List')).toBeDefined()
		expect(await screen.findByTitle('Ordered List')).toBeDefined()
	})
})
