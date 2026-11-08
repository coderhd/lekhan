import { expect, it, vi } from 'vitest'
import DocumentPage from '@/app/doc/[id]/page'
import { redirect } from 'next/navigation'
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
it('awaits legacy params and redirects the unchanged id to the guarded page route', async () => {
 const id = '31709c9e-cd23-4cdb-9339-edfbc4bacee1'
 await expect(DocumentPage({ params: Promise.resolve({ id }) })).rejects.toThrow('NEXT_REDIRECT')
 expect(redirect).toHaveBeenCalledWith(`/page/${id}`)
})
