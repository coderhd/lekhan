import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import VersionHistory from '@/components/version-history'
import React from 'react'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			or: vi.fn().mockReturnThis(),
			then: vi.fn((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
		})),
	},
}))

describe('VersionHistory Retention Reassurance', () => {
	it('displays plan-specific retention reassurance note', () => {
		render(
			<VersionHistory
				documentId="doc1"
				isOpen={true}
				onClose={() => {}}
				onPreviewVersion={() => {}}
				plan="free"
			/>
		)
		expect(screen.getByText(/7-day cloud & local version history included in Free plan/i)).toBeInTheDocument()
	})
})
