'use server'

import { redirect } from 'next/navigation'
import { createServerAdmin } from '@/lib/auth/admin'
import { accountContext } from '@/lib/auth/server'
import { pageAccess, uuidPattern } from '@/lib/cloud/graph'
import { collaboratorLimit, invitationEmail, sharingRole } from '@/lib/cloud/sharing'
import { recordAnalyticsReceipt } from '@/lib/server/analytics'

export async function updateSharing(pageId: string, form: FormData) {
  if (!uuidPattern.test(pageId)) redirect('/cloud')
  const path = '/page/' + pageId + '/share'
  const account = await accountContext()
  if (!account) redirect('/login')
  const page = await pageAccess(account.client, pageId, account.subject)
  if (page?.role !== 'owner') redirect('/cloud')

  const change = form.get('change')
  const role = sharingRole(form.get('role'))
  const target = form.get('target')
  let outcome = 'unavailable'
  try {
    if (change === 'publish' || change === 'unpublish') {
      const { data, error } = await account.client.from('pages').update({ is_public: change === 'publish' })
        .eq('id', pageId).eq('owner_id', account.subject).select('id').maybeSingle()
      if (!error && data) outcome = 'saved'
    } else if (change === 'invite') {
      const email = invitationEmail(form.get('email'))
      const admin = createServerAdmin()
      if (!email || !role) outcome = 'invalid'
      else if (admin) {
        const limit = await collaboratorLimit(admin, page.page.workspace_id)
        const { error } = await admin.rpc('rebuild_create_page_invitation', {
          target_page: pageId, actor: account.subject, email_address: email, access_role: role, collaborator_limit: limit,
        })
        outcome = error ? ({ collaborator_limit: 'limit', already_has_access: 'existing', invitation_already_pending: 'pending' }[error.message] ?? 'unavailable') : 'invited'
      }
    } else if (typeof target === 'string' && uuidPattern.test(target)) {
      if (change === 'cancel') {
        const { error, data } = await account.client.from('page_invitations').delete().eq('page_id', pageId)
          .eq('id', target).eq('status', 'pending').select('id').maybeSingle()
        if (!error && data) outcome = 'saved'
      } else if (target !== account.subject && (change === 'remove' || (change === 'role' && role))) {
        const members = account.client.from('page_members')
        const mutation = change === 'remove' ? members.delete() : members.update({ role })
        const { error, data } = await mutation.eq('page_id', pageId).eq('user_id', target)
          .in('role', ['editor', 'viewer']).select('id').maybeSingle()
        if (!error && data) outcome = 'saved'
      }
    }
  } catch {
    outcome = 'unavailable'
  }

  if (outcome === 'limit') await recordAnalyticsReceipt('collaborators')
  redirect(path + '?result=' + outcome)
}
