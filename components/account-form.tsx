'use client'

import { useActionState } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import type { AuthMode } from '@/lib/auth/input'
import { submitAuth } from '@/app/auth/actions'
import { track } from '@/lib/analytics'

export function AccountForm({ mode, invite, referral, transfer }: {
  mode: AuthMode; invite?: string; referral?: string; transfer?: string
}) {
  const t = useTranslations('auth')
  const [state, action, pending] = useActionState(submitAuth.bind(null, mode, invite, referral, transfer), null)
  if (state && 'outcome' in state) return <p className="account-feedback" role="status">{t(state.outcome)}</p>

  const password = mode !== 'forgot'
  const newPassword = mode === 'signup' || mode === 'reset'
  const submit = { login: 'login', signup: 'signup', forgot: 'sendReset', reset: 'savePassword' } as const
  return (
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
      <button className="primary-button" disabled={pending}>{t(pending ? 'working' : submit[mode])}</button>
    </form>
  )
}
