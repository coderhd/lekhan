'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { authConfig, confirmationTarget, siteOrigin } from '@/lib/auth/config'
import { createAuthClient } from '@/lib/auth/server'
import { offlineAccountCookie } from '@/lib/cloud/offline-account'
import { billingNextPath, invitationPath, readCredentials, referralCode, workspaceTransferPath, type AuthMode, type AuthResult } from '@/lib/auth/input'
import { googleCallback, googleFlowCookie, googleFlowLifetime, googleOAuthEnabled } from '@/lib/auth/google-oauth'
import { recordAnalyticsReceipt } from '@/lib/server/analytics'

export async function submitAuth(mode: AuthMode, invite: string | undefined, referral: string | undefined, transfer: string | undefined,
  nextTarget: string | undefined, _previous: AuthResult, form: FormData): Promise<AuthResult> {
  if (!['login', 'signup', 'forgot', 'reset'].includes(mode)) return { issue: 'invalid' }
  const credentials = readCredentials(form, mode)
  if (!credentials) return { issue: 'invalid' }
  const client = await createAuthClient()
  if (!client) return { issue: 'unavailable' }
  const { email, password } = credentials
  const next = invitationPath(invite)
  const billingNext = billingNextPath(nextTarget)

  if (mode === 'login') {
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) return { issue: 'loginError' }
    await clearGoogleFlow()
    redirect(workspaceTransferPath(transfer) ?? next ?? billingNext ?? '/workspace')
  }

  if (mode === 'reset') {
    const { data, error: sessionError } = await client.auth.getClaims()
    if (sessionError || !data?.claims.sub) return { issue: 'resetError' }
    const { error } = await client.auth.updateUser({ password })
    if (error) return { issue: 'resetError' }
    redirect('/workspace')
  }

  const callback = confirmationTarget(mode === 'forgot' ? 'recovery' : 'email', next && invite ? invite : undefined)
  if (!callback) return { issue: 'unavailable' }
  if (mode === 'forgot') {
    await client.auth.resetPasswordForEmail(email, { redirectTo: callback })
    return { outcome: 'resetEmail' }
  }

  const ref = referralCode(referral)
  const { data, error } = await client.auth.signUp({
    email, password, options: { emailRedirectTo: callback, ...(ref ? { data: { referred_by: ref } } : {}) },
  })
  if (error && error.status !== 422) return { issue: 'signupError' }
  if (data.session) {
    await clearGoogleFlow()
    await recordAnalyticsReceipt('signup')
    redirect(next ?? billingNext ?? '/workspace')
  }
  return { outcome: 'confirmEmail' }
}


export async function startGoogleSignIn(invite: string | undefined, transfer: string | undefined,
  _previous: { issue: 'googleError' } | null, form: FormData): Promise<{ issue: 'googleError' }> {
  const origin = siteOrigin()
  const config = authConfig()
  if (!googleOAuthEnabled() || !origin || !config) return { issue: 'googleError' }
  const client = await createAuthClient()
  if (!client) return { issue: 'googleError' }

  const id = crypto.randomUUID()
  const desktop = form.get('desktop') === '1'
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: googleCallback(origin, id, desktop), skipBrowserRedirect: true },
  })
  if (error || !data.url) return { issue: 'googleError' }
  const authorize = new URL(data.url)
  if (authorize.origin !== config.url || authorize.pathname !== '/auth/v1/authorize') return { issue: 'googleError' }
  const store = await cookies()
  store.set(googleFlowCookie, JSON.stringify({
    id, start: Date.now(),
    invite: invitationPath(invite) ? invite : undefined,
    transfer: workspaceTransferPath(transfer) ? transfer : undefined,
  }), { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/auth', maxAge: googleFlowLifetime })
  redirect(authorize.href)
}

export async function signOut() {
  const client = await createAuthClient()
  const result = await client?.auth.signOut({ scope: 'local' })
  const store = await cookies()
  store.set(offlineAccountCookie, '', { path: '/', maxAge: 0 })
  await clearGoogleFlow()
  redirect(result?.error ? '/login?error=signout' : '/login')
}

async function clearGoogleFlow() {
  const store = await cookies()
  store.set(googleFlowCookie, '', { path: '/auth', maxAge: 0 })
}
