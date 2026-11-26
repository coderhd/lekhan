'use client'

import { useActionState } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import type { AuthMode } from '@/lib/auth/input'
import { startGoogleSignIn, submitAuth } from '@/app/auth/actions'
import { track } from '@/lib/analytics'

export function AccountForm({ mode, invite, referral, transfer, google = false }: {
  mode: AuthMode; invite?: string; referral?: string; transfer?: string; google?: boolean
}) {
  const t = useTranslations('auth')
  const [state, action, pending] = useActionState(submitAuth.bind(null, mode, invite, referral, transfer), null)
  const [socialState, socialAction, socialPending] = useActionState(startGoogleSignIn.bind(null, invite, transfer), null)
  if (state && 'outcome' in state) return <p className="account-feedback" role="status">{t(state.outcome)}</p>

  const password = mode !== 'forgot'
  const newPassword = mode === 'signup' || mode === 'reset'
  const submit = { login: 'login', signup: 'signup', forgot: 'sendReset', reset: 'savePassword' } as const
  return <>
    <form className="account-form" action={action} onSubmit={mode === 'signup' ? () => track('signup_started', 'email') : undefined}>
      {mode !== 'reset' && <label>{t('email')}
        <input type="email" name="email" autoComplete="email" maxLength={254} required />
      </label>}
      {password && <label>{t(newPassword ? 'newPassword' : 'password')}
        <input type="password" name="password" autoComplete={newPassword ? 'new-password' : 'current-password'} minLength={newPassword ? 8 : undefined} maxLength={256} required />
      </label>}
      {mode === 'reset' && <label>{t('confirmPassword')}
        <input type="password" name="confirmPassword" autoComplete="new-password" minLength={8} maxLength={256} required />
      </label>}
      {state && 'issue' in state && <p className="account-error" role="alert">{t(state.issue)}</p>}
      <button className="primary-button" disabled={pending || socialPending}>{t(pending ? 'working' : submit[mode])}</button>
    </form>
    {google && <form className="account-form account-google" action={socialAction} onSubmit={event => {
      const field = event.currentTarget.elements.namedItem('desktop')
      if (field instanceof HTMLInputElement) field.value = Reflect.get(window, '__LEKHAN_CLOUD_DESKTOP__') === true ? '1' : '0'
      if (mode === 'signup') track('signup_started', 'google')
    }}>
      <input type="hidden" name="desktop" defaultValue="0" />
      {socialState && <p className="account-error" role="alert">{t(socialState.issue)}</p>}
      <button className="secondary-button" disabled={pending || socialPending}>{t(socialPending ? 'working' : 'googleContinue')}</button>
    </form>}
  </>
}
