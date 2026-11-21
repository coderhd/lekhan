'use server'

import { redirect } from 'next/navigation'
import { createServerAdmin } from '@/lib/auth/admin'
import { invitationPath } from '@/lib/auth/input'
import { accountContext } from '@/lib/auth/server'
import { collaboratorLimit, inspectInvitation, type InvitationDetails } from '@/lib/cloud/sharing'

export async function respondToInvitation(token: string, form: FormData) {
  const path = invitationPath(token)
  if (!path) redirect('/cloud?view=invitations')
  const account = await accountContext()
  if (!account) redirect('/login?' + new URLSearchParams({ invite: token }))

  const operation = form.get('response')
  const admin = createServerAdmin()
  let outcome = 'unavailable'
  let result: InvitationDetails | null = null
  if (admin && (operation === 'accepted' || operation === 'declined')) {
    try {
      const current = await inspectInvitation(admin, token, account.subject)
      if (current && current.status === 'pending') {
        const page = await admin.from('pages').select('workspace_id').eq('id', current.page_id).single()
        if (page.error) throw page.error
        const limit = operation === 'accepted' ? await collaboratorLimit(admin, page.data.workspace_id) : 0
        const reply = await admin.rpc('rebuild_page_invitation', {
          invitation_token: token, actor: account.subject, operation, collaborator_limit: limit,
        }).maybeSingle<InvitationDetails>()
        if (reply.error) outcome = reply.error.message === 'collaborator_limit' ? 'limit' : 'unavailable'
        else result = reply.data
      } else result = current
    } catch {
      outcome = 'unavailable'
    }
  }

  if (result?.status === 'accepted') redirect('/page/' + result.page_id)
  if (result?.status === 'declined') redirect('/cloud?view=invitations&notice=declined')
  redirect(path + '?' + new URLSearchParams({ result: outcome }))
}
