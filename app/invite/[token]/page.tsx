import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerAdmin } from '@/lib/auth/admin'
import { invitationPath } from '@/lib/auth/input'
import { accountContext } from '@/lib/auth/server'
import { inspectInvitation } from '@/lib/cloud/sharing'
import { respondToInvitation } from './actions'

export const metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function InvitationPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  if (!invitationPath(token)) notFound()
  const account = await accountContext()
  if (!account) redirect('/login?' + new URLSearchParams({ invite: token }))

  const admin = createServerAdmin()
  const invite = admin && await inspectInvitation(admin, token, account.subject).catch(() => null)
  const { result } = await searchParams
  if (invite?.status === 'accepted') redirect('/page/' + invite.page_id)
  if (invite?.status === 'declined') redirect('/cloud?view=invitations&notice=declined')

  return <main className="account-screen">
    <header className="account-header">
      <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> Cloud workspace</Link>
    </header>
    <section className="account-card" aria-labelledby="invitation-heading">
      <h1 id="invitation-heading">Page invitation</h1>
      {invite ? <>
        <p><strong>{invite.title}</strong></p>
        <p>{invite.role === 'editor' ? 'You’re invited to edit this page.' : 'You’re invited to view this page.'}</p>
        {result && <p role="alert" className="account-error">{result === 'limit'
          ? 'This page has reached its collaborator limit. Ask the owner to review access.'
          : 'Could not respond to this invitation. Try again in a moment.'}</p>}
        <form className="invitation-actions" action={respondToInvitation.bind(null, token)}>
          <button className="primary-button" name="response" value="accepted">Accept invitation</button>
          <button className="secondary-button" name="response" value="declined">Decline</button>
        </form>
      </> : <>
        <p>This invitation is unavailable. Check that you’re signed in with the invited email address.</p>
        <Link className="account-link" href={'/login?' + new URLSearchParams({ invite: token })}>Sign in with another account</Link>
      </>}
    </section>
  </main>
}
