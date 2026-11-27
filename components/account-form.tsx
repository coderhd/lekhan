'use client'

import { ArrowRight } from 'lucide-react'
import { useActionState, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { VStack } from '@astryxdesign/core/Stack'
import { TextInput } from '@astryxdesign/core/TextInput'
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

export function AccountForm({ mode, invite, referral, transfer, nextTarget, google = false }: {
  mode: AuthMode; invite?: string; referral?: string; transfer?: string; nextTarget?: string; google?: boolean
}) {
  const t = useTranslations('auth')
  const [state, action, pending] = useActionState(submitAuth.bind(null, mode, invite, referral, transfer, nextTarget), null)
  const [socialState, socialAction, socialPending] = useActionState(startGoogleSignIn.bind(null, invite, transfer), null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  if (state && 'outcome' in state) {
    return (
      <div role="status">
        <Banner status="info" collapsible={false} title={t(state.outcome)} />
      </div>
    )
  }

  const hasPassword = mode !== 'forgot'
  const newPassword = mode === 'signup' || mode === 'reset'
  const submit = { login: 'login', signup: 'signup', forgot: 'sendReset', reset: 'savePassword' } as const

  return (
    <VStack gap={3}>
      <form action={action} onSubmit={mode === 'signup' ? () => track('signup_started', 'email') : undefined}>
        <VStack gap={3}>
          {mode !== 'reset' && (
            <TextInput
              type="email"
              label={t('email')}
              htmlName="email"
              autoComplete="email"
              isRequired
              width="100%"
              value={email}
              onChange={value => setEmail(value.slice(0, 254))}
            />
          )}
          {hasPassword && (
            <TextInput
              type="password"
              label={t(newPassword ? 'newPassword' : 'password')}
              htmlName="password"
              autoComplete={newPassword ? 'new-password' : 'current-password'}
              isRequired
              width="100%"
              value={password}
              onChange={value => setPassword(value.slice(0, 256))}
            />
          )}
          {mode === 'reset' && (
            <TextInput
              type="password"
              label={t('confirmPassword')}
              htmlName="confirmPassword"
              autoComplete="new-password"
              isRequired
              width="100%"
              value={confirmPassword}
              onChange={value => setConfirmPassword(value.slice(0, 256))}
            />
          )}
          {state && 'issue' in state && (
            <div role="alert">
              <Banner status="error" collapsible={false} title={t(state.issue)} />
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            width="100%"
            isLoading={pending}
            isDisabled={pending || socialPending}
            label={t(pending ? 'working' : submit[mode])}
            endContent={<ArrowRight size={17} aria-hidden="true" />}
          />
        </VStack>
      </form>
      {google && (
        <>
          <Divider />
          <form action={socialAction} onSubmit={event => {
            const field = event.currentTarget.elements.namedItem('desktop')
            if (field instanceof HTMLInputElement) field.value = Reflect.get(window, '__LEKHAN_CLOUD_DESKTOP__') === true ? '1' : '0'
            if (mode === 'signup') track('signup_started', 'google')
          }}>
            <VStack gap={2}>
              <input type="hidden" name="desktop" defaultValue="0" />
              {socialState && (
                <div role="alert">
                  <Banner status="error" collapsible={false} title={t(socialState.issue)} />
                </div>
              )}
              <Button
                type="submit"
                variant="secondary"
                width="100%"
                isLoading={socialPending}
                isDisabled={pending || socialPending}
                icon={<GoogleMark />}
                label={t(socialPending ? 'working' : 'googleContinue')}
              />
            </VStack>
          </form>
        </>
      )}
    </VStack>
  )
}
