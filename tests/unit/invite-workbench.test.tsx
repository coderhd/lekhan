import '@testing-library/jest-dom'
import { Suspense } from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import InvitePage from '@/app/invite/[token]/page'
const mocks = vi.hoisted(() => ({
 router: { push: vi.fn() },
 getSession: vi.fn(), fetchPageInvitationDetails: vi.fn(), acceptPageInvitation: vi.fn(), declinePageInvitation: vi.fn()
}))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: mocks.getSession } } }))
vi.mock('@/services/graph', () => ({ fetchPageInvitationDetails: mocks.fetchPageInvitationDetails, acceptPageInvitation: mocks.acceptPageInvitation, declinePageInvitation: mocks.declinePageInvitation }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
const invite = { id: 'invite-1', page_id: 'page-1', status: 'pending', role: 'viewer', pages: { title: 'Shared writing' }, profiles: { email: 'owner@example.com' } }
beforeEach(() => {
 vi.clearAllMocks()
 mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'writer-1' } } } })
 mocks.fetchPageInvitationDetails.mockResolvedValue(invite)
 mocks.acceptPageInvitation.mockResolvedValue(undefined)
})
async function openInvite() {
 const params = Promise.resolve({ token: 'invite-token' })
 await act(async () => { render(<Suspense fallback="Loading invitation"><InvitePage params={params} /></Suspense>) })
}
it('shows an unavailable invitation without an accepted state or private title', async () => {
 mocks.fetchPageInvitationDetails.mockResolvedValue({ ...invite, status: 'declined' })
 await openInvite()
 expect(await screen.findByRole('alert')).toHaveTextContent(/invitation is no longer available/i)
 expect(screen.queryByText('Shared writing')).toBeNull()
 expect(mocks.acceptPageInvitation).not.toHaveBeenCalled()
})
it('retains the pending invitation after acceptance fails and retries the same invitation', async () => {
 mocks.acceptPageInvitation.mockRejectedValueOnce(new Error('Try again'))
 await openInvite()
 fireEvent.click(await screen.findByRole('button', { name: 'Accept Invitation' }))
 expect(await screen.findByRole('alert')).toHaveTextContent('Try again')
 expect(screen.getByText('Shared writing')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Accept Invitation' }))
 await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/page/page-1'))
 expect(mocks.acceptPageInvitation).toHaveBeenLastCalledWith(invite, 'writer-1')
})
