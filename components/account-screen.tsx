import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { authConfig, siteOrigin } from '@/lib/auth/config'
import { googleOAuthEnabled } from '@/lib/auth/google-oauth'
import { invitationPath, referralCode, workspaceTransferPath, type AuthMode } from '@/lib/auth/input'
import { AccountForm } from './account-form'
import LocaleSwitcher from './locale-switcher'

export default async function AccountScreen({ mode, notice, invite, referral, transfer }: {
  mode: AuthMode
  notice?: string
  invite?: string
  referral?: string
  transfer?: string
}) {
  const t = await getTranslations('auth')
  const titles = { login: 'login', signup: 'signup', forgot: 'forgot', reset: 'reset' } as const
  const ready = !!authConfig() && ((mode === 'login' || mode === 'reset') || !!siteOrigin())
  const token = invitationPath(invite) ? invite : undefined
  const ref = referralCode(referral)
  const query = new URLSearchParams()
  if (token) query.set('invite', token)
  if (ref) query.set('ref', ref)
  const next = query.size ? '?' + query : ''
  return (
    <main className="account-screen">
      <header className="account-header">
        <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
        <LocaleSwitcher />
      </header>
      <section className="account-card" aria-labelledby="account-title">
        <h1 id="account-title">{t(titles[mode])}</h1>
        {mode === 'forgot' && <p>{t('forgotIntro')}</p>}
        {notice === 'confirm' && <p className="account-error" role="alert">{t('confirmError')}</p>}
        {notice === 'signout' && <p className="account-error" role="alert">{t('signoutError')}</p>}
        {notice === 'google' && <p className="account-error" role="alert">{t('googleError')}</p>}
        {ready ? <AccountForm mode={mode} invite={token} referral={ref}
          google={googleOAuthEnabled() && !!siteOrigin() && !ref && (mode === 'login' || mode === 'signup')}
          transfer={workspaceTransferPath(transfer) ? transfer : undefined} /> : <p role="status">{t('unavailable')}</p>}
        <div className="account-links">
          {mode === 'login' && <Link href="/forgot-password">{t('forgot')}</Link>}
          {mode === 'login' && <Link href={'/signup' + next}>{t('signup')}</Link>}
          {mode !== 'login' && <Link href={'/login' + next}>{t('login')}</Link>}
          <Link href="/workspace">{t('localWorkspace')}</Link>
        </div>
      </section>
    </main>
  )
}
