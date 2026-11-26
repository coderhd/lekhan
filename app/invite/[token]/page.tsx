import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
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

  const t = await getTranslations('cloud-workspace')
  return <main className="account-screen">
    <header className="account-header">
      <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> {t('title')}</Link>
    </header>
    <section className="account-card" aria-labelledby="invitation-heading">
      <h1 id="invitation-heading">{t('invitationTitle')}</h1>
      {invite ? <>
        <p><strong>{invite.title}</strong></p>
        <p>{invite.role === 'editor' ? t('invitedToEdit') : t('invitedToView')}</p>
        {result && <p role="alert" className="account-error">{result === 'limit'
          ? t('recipientLimit')
          : result === 'plan_changed' ? t('planChangedAccept')
            : t('respondFailed')}</p>}
        <form className="invitation-actions" action={respondToInvitation.bind(null, token)}>
          <button className="primary-button" name="response" value="accepted">{t('acceptInvitation')}</button>
          <button className="secondary-button" name="response" value="declined">{t('decline')}</button>
        </form>
      </> : <>
        <p>{t('invalidRecipient')}</p>
        <Link className="account-link" href={'/login?' + new URLSearchParams({ invite: token })}>{t('switchAccount')}</Link>
      </>}
    </section>
  </main>
}
