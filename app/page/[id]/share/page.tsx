import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { siteOrigin } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'
import { pageAccess } from '@/lib/cloud/graph'
import type { SharedRole } from '@/lib/cloud/sharing'
import InviteLink from '@/components/invite-link'
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

const messages: Record<string, string> = {
  invited: 'Invitation ready. Copy its link to send it.',
  saved: 'Page access updated.',
  invalid: 'Enter a valid email address and choose a role.',
  existing: 'That account already has access.',
  pending: 'An invitation for this address is already pending. Cancel it before changing the role.',
  limit: 'This page has reached its collaborator limit. Cancel a pending invitation or remove a member to make room.',
  unavailable: 'Could not update page access. Try again in a moment.',
}

export default async function SharePage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { id } = await params
  const account = await accountContext()
  if (!account) redirect('/login')
  const access = await pageAccess(account.client, id, account.subject)
  if (access?.role !== 'owner') notFound()

  const [members, invites, { result }] = await Promise.all([
    account.client.from('page_members').select('user_id,role,profiles:user_id(full_name,email)')
      .eq('page_id', id).in('role', ['editor', 'viewer']).order('created_at').limit(100).returns<Member[]>(),
    account.client.from('page_invitations').select('id,invitee_email,role,token').eq('page_id', id)
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(100).returns<PendingInvite[]>(),
    searchParams,
  ])
  const action = updateSharing.bind(null, id)
  const ok = result === 'invited' || result === 'saved'
  const message = result && Object.hasOwn(messages, result) ? messages[result] : null

  return <main className="cloud-screen">
    <header className="account-header">
      <Link className="account-brand" href={'/page/' + id}><span className="brand-mark" aria-hidden="true">L</span> Back to page</Link>
    </header>
    <article className="cloud-library sharing">
      <h1>Share page</h1>
      <p>{access.page.title}</p>
      {message && <p role={ok ? 'status' : 'alert'} className={ok ? 'account-feedback' : 'account-error'}>{message}</p>}

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invite by email</h2>
        <form action={action} className="cloud-create">
          <label>Email address <input type="email" name="email" maxLength={254} required /></label>
          <label>Access <select name="role" defaultValue="viewer"><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
          <button className="primary-button" name="change" value="invite">Create invitation</button>
        </form>
      </section>

      <section aria-labelledby="people-heading">
        <h2 id="people-heading">People with access</h2>
        {members.error && <p role="alert">Could not load page members.</p>}
        <ul className="sharing-list">
          <li><strong>You</strong><span>Owner</span></li>
          {members.data?.map(member => <li key={member.user_id}>
            <div><strong>{member.profiles?.full_name || member.profiles?.email || 'Collaborator'}</strong>
              {member.profiles?.full_name && <div>{member.profiles.email}</div>}
            </div>
            <form action={action}>
              <input type="hidden" name="target" value={member.user_id} />
              <select name="role" aria-label={'Access for ' + (member.profiles?.email ?? member.user_id)} defaultValue={member.role}>
                <option value="viewer">Can view</option><option value="editor">Can edit</option>
              </select>
              <button className="secondary-button" name="change" value="role">Save role</button>
              <button className="secondary-button" name="change" value="remove">Remove</button>
            </form>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading">Pending invitations</h2>
        {invites.error ? <p role="alert">Could not load invitations.</p> : invites.data.length === 0 ? <p>No pending invitations.</p> :
          <ul className="sharing-list">{invites.data.map(invite => <li key={invite.id}>
            <div><strong>{invite.invitee_email}</strong> <span>{invite.role === 'editor' ? 'Can edit' : 'Can view'}</span>
              <InviteLink path={'/invite/' + invite.token} origin={siteOrigin()} />
            </div>
            <form action={action}>
              <input type="hidden" name="target" value={invite.id} />
              <button className="secondary-button" name="change" value="cancel">Cancel invitation</button>
            </form>
          </li>)}</ul>}
      </section>
    </article>
  </main>
}
