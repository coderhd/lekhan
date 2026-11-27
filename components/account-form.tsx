'use client'

import { ArrowRight } from 'lucide-react'
import { useActionState } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import type { AuthMode } from '@/lib/auth/input'
import { startGoogleSignIn, submitAuth } from '@/app/auth/actions'
import { track } from '@/lib/analytics'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.68-.22-2.48H12v4.69h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.83Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.38-2.3V6.6H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.4l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  )
}

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
      <button className="primary-button account-primary-button" disabled={pending || socialPending}>
        <span>{t(pending ? 'working' : submit[mode])}</span>
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </form>
    {google && <>
      <div className="account-divider" role="separator" aria-hidden="true" />
      <form className="account-form account-google" action={socialAction} onSubmit={event => {
        const field = event.currentTarget.elements.namedItem('desktop')
        if (field instanceof HTMLInputElement) field.value = Reflect.get(window, '__LEKHAN_CLOUD_DESKTOP__') === true ? '1' : '0'
        if (mode === 'signup') track('signup_started', 'google')
      }}>
        <input type="hidden" name="desktop" defaultValue="0" />
        {socialState && <p className="account-error" role="alert">{t(socialState.issue)}</p>}
        <button className="secondary-button account-google-button" disabled={pending || socialPending}>
          <GoogleMark />
          <span>{t(socialPending ? 'working' : 'googleContinue')}</span>
        </button>
      </form>
    </>}
  </>
}
