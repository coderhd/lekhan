'use server'

import { redirect } from 'next/navigation'
import { confirmationTarget } from '@/lib/auth/config'
import { createAuthClient } from '@/lib/auth/server'
import { invitationPath, readCredentials, type AuthMode, type AuthResult } from '@/lib/auth/input'

export async function submitAuth(mode: AuthMode, invite: string | undefined, _previous: AuthResult, form: FormData): Promise<AuthResult> {
  if (!['login', 'signup', 'forgot', 'reset'].includes(mode)) return { issue: 'invalid' }
  const credentials = readCredentials(form, mode)
  if (!credentials) return { issue: 'invalid' }
  const client = await createAuthClient()
  if (!client) return { issue: 'unavailable' }
  const { email, password } = credentials
  const next = invitationPath(invite)

  if (mode === 'login') {
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) return { issue: 'loginError' }
    redirect(next ?? '/')
  }

  if (mode === 'reset') {
    const { data, error: sessionError } = await client.auth.getClaims()
    if (sessionError || !data?.claims.sub) return { issue: 'resetError' }
    const { error } = await client.auth.updateUser({ password })
    if (error) return { issue: 'resetError' }
    redirect('/')
  }

  const callback = confirmationTarget(mode === 'forgot' ? 'recovery' : 'email', next && invite ? invite : undefined)
  if (!callback) return { issue: 'unavailable' }
  if (mode === 'forgot') {
    await client.auth.resetPasswordForEmail(email, { redirectTo: callback })
    return { outcome: 'resetEmail' }
  }

  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: callback } })
  if (error && error.status !== 422) return { issue: 'signupError' }
  if (data.session) redirect(next ?? '/')
  return { outcome: 'confirmEmail' }
}

export async function signOut() {
  const client = await createAuthClient()
  const result = await client?.auth.signOut({ scope: 'local' })
  redirect(result?.error ? '/login?error=signout' : '/login')
}
