'use server'

import { revalidatePath } from 'next/cache'
import { accountContext } from '@/lib/auth/server'

export async function saveDisplayName(_previous: { outcome?: 'saved' | 'error' }, form: FormData): Promise<{ outcome?: 'saved' | 'error' }> {
  const name = form.get('display-name')
  const account = await accountContext()
  if (!account || form.get('subject') !== account.subject || typeof name !== 'string' ||
    name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(name)) return { outcome: 'error' }
  const { error } = await account.client.auth.updateUser({ data: { full_name: name.trim() } })
  if (error) return { outcome: 'error' }
  revalidatePath('/settings')
  revalidatePath('/workspace')
  return { outcome: 'saved' }
}
