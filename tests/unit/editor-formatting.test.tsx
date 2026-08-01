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
			provider: null
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

// Mock fetch Document calls
vi.mock('@/services/db', () => ({
	fetchDocumentDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false }),
	fetchMemberRole: vi.fn().mockResolvedValue('owner'),
	updateDocumentTitle: vi.fn().mockResolvedValue(true),
	fetchMentionableCollaborators: vi.fn().mockResolvedValue([]),
	getUserAICredits: vi.fn().mockResolvedValue({ tier: 'free', total_credits: 50, credits_used: 0 }),
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
				documentId="doc-1" 
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
