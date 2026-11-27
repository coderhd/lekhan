'use server'

import { redirect } from 'next/navigation'
import { accountContext } from '@/lib/auth/server'
import { pageTitle, uuidPattern } from '@/lib/cloud/graph'

export async function renameCloudPage(id: string, form: FormData) {
  if (!uuidPattern.test(id)) redirect('/cloud')
  const account = await accountContext()
  if (!account) redirect('/login')
  const title = pageTitle(form.get('title'))
  if (!title) redirect('/page/' + id + '?error=title')
  const { data, error } = await account.client.from('pages').update({ title }).eq('id', id)
    .eq('owner_id', account.subject).select('id').maybeSingle()
  redirect('/page/' + id + (error || !data ? '?error=save' : ''))
}
