'use server'

import { redirect } from 'next/navigation'
import { accountContext } from '@/lib/auth/server'
import { createCloudPage, pageTitle, uuidPattern } from '@/lib/cloud/graph'

export async function addCloudPage(form: FormData) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const title = pageTitle(form.get('title'))
  const parentId = form.get('parentId')
  if (!title || (parentId !== null && (typeof parentId !== 'string' || !uuidPattern.test(parentId)))) {
    redirect('/cloud?error=title')
  }

  let id: string
  try {
    id = await createCloudPage(account.client, account.subject, title, typeof parentId === 'string' ? parentId : undefined)
  } catch {
    redirect('/cloud?error=save')
  }
  redirect('/page/' + id)
}
