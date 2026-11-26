import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { siteOrigin } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'
import { pageAccess } from '@/lib/cloud/graph'
import type { SharedRole } from '@/lib/cloud/sharing'
import InviteLink from '@/components/invite-link'
import { UsageAnalyticsReceipts } from '@/components/usage-analytics'
import { updateSharing } from './actions'

interface Member {
  user_id: string
  role: SharedRole
  profiles: { full_name: string | null; email: string | null } | null
}

interface PendingInvite {
  id: string
  invitee_email: string
  role: SharedRole
  token: string
}

const messages = {
  invited: 'invitationReady', saved: 'accessUpdated', invalid: 'invalidInvitation',
  existing: 'existingAccess', pending: 'invitationAlreadyPending', limit: 'memberLimit',
  plan_changed: 'planChangedInvite', unavailable: 'accessUpdateFailed',
} as const

export default async function SharePage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { id } = await params
  const account = await accountContext()
  if (!account) redirect('/login')
  const access = await pageAccess(account.client, id, account.subject)
  if (access?.role !== 'owner') notFound()

  const [members, invites, { result }, t] = await Promise.all([
    account.client.from('page_members').select('user_id,role,profiles:user_id(full_name,email)')
      .eq('page_id', id).in('role', ['editor', 'viewer']).order('created_at').limit(100).returns<Member[]>(),
    account.client.from('page_invitations').select('id,invitee_email,role,token').eq('page_id', id)
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(100).returns<PendingInvite[]>(),
    searchParams,
    getTranslations('cloud-workspace'),
  ])
  const action = updateSharing.bind(null, id)
  const ok = result === 'invited' || result === 'saved'
  const message = result && Object.hasOwn(messages, result) ? t(messages[result as keyof typeof messages]) : null

  return <main className="cloud-screen">
    <header className="account-header">
      <Link className="account-brand" href={'/page/' + id}><span className="brand-mark" aria-hidden="true">L</span> {t('backToPage')}</Link>
    </header>
    <article className="cloud-library sharing">
      <h1>{t('sharePage')}</h1>
      <p>{access.page.title}</p>
      {result === 'limit' && <UsageAnalyticsReceipts />}
      {message && <p role={ok ? 'status' : 'alert'} className={ok ? 'account-feedback' : 'account-error'}>
        {message}{result === 'limit' && <> <Link className="account-link" href="/billing">{t('comparePlans')}</Link></>}
      </p>}

      <section aria-labelledby="public-access-heading">
        <h2 id="public-access-heading">{t('linkAccess')}</h2>
        <p>{access.page.is_public ? t('publicAccess') : t('privateAccess')}</p>
        {access.page.is_public && <InviteLink path={'/page/' + id} origin={siteOrigin()} label={t('publicLink')} />}
        <form action={action} className="cloud-create">
          <button className="secondary-button" name="change" value={access.page.is_public ? 'unpublish' : 'publish'}>
            {access.page.is_public ? t('unpublish') : t('publish')}
          </button>
        </form>
      </section>

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">{t('inviteByEmail')}</h2>
        <form action={action} className="cloud-create">
          <label>{t('email')} <input type="email" name="email" maxLength={254} required /></label>
          <label>{t('access')} <select name="role" defaultValue="viewer"><option value="viewer">{t('canView')}</option><option value="editor">{t('canEdit')}</option></select></label>
          <button className="primary-button" name="change" value="invite">{t('createInvitation')}</button>
        </form>
      </section>

      <section aria-labelledby="people-heading">
        <h2 id="people-heading">{t('peopleWithAccess')}</h2>
        {members.error && <p role="alert">{t('membersUnavailable')}</p>}
        <ul className="sharing-list">
          <li><strong>{t('you')}</strong><span>{t('owner')}</span></li>
          {members.data?.map(member => <li key={member.user_id}>
            <div><strong>{member.profiles?.full_name || member.profiles?.email || t('collaborator')}</strong>
              {member.profiles?.full_name && <div>{member.profiles.email}</div>}
            </div>
            <form action={action}>
              <input type="hidden" name="target" value={member.user_id} />
              <select name="role" aria-label={t('accessFor', { person: member.profiles?.email ?? member.user_id })} defaultValue={member.role}>
                <option value="viewer">{t('canView')}</option><option value="editor">{t('canEdit')}</option>
              </select>
              <button className="secondary-button" name="change" value="role">{t('saveRole')}</button>
              <button className="secondary-button" name="change" value="remove">{t('remove')}</button>
            </form>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading">{t('pendingInvitations')}</h2>
        {invites.error ? <p role="alert">{t('invitationsUnavailable')}</p> : invites.data.length === 0 ? <p>{t('noInvitations')}</p> :
          <ul className="sharing-list">{invites.data.map(invite => <li key={invite.id}>
            <div><strong>{invite.invitee_email}</strong> <span>{invite.role === 'editor' ? t('canEdit') : t('canView')}</span>
              <InviteLink path={'/invite/' + invite.token} origin={siteOrigin()} />
            </div>
            <form action={action}>
              <input type="hidden" name="target" value={invite.id} />
              <button className="secondary-button" name="change" value="cancel">{t('cancelInvitation')}</button>
            </form>
          </li>)}</ul>}
      </section>
    </article>
  </main>
}
