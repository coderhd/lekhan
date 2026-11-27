import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { authConfig, docsOrigin, siteOrigin } from '@/lib/auth/config'
import { googleOAuthEnabled } from '@/lib/auth/google-oauth'
import { billingNextPath, invitationPath, referralCode, workspaceTransferPath, type AuthMode } from '@/lib/auth/input'
import { AccountForm } from './account-form'
import LocaleSwitcher from './locale-switcher'

export default async function AccountScreen({ mode, notice, invite, referral, transfer, nextTarget }: {
  mode: AuthMode
  notice?: string
  invite?: string
  referral?: string
  transfer?: string
  nextTarget?: string
}) {
  const [t, marketing] = await Promise.all([getTranslations('auth'), getTranslations('marketing')])
  const titles = { login: 'login', signup: 'signup', forgot: 'forgot', reset: 'reset' } as const
  const ready = !!authConfig() && ((mode === 'login' || mode === 'reset') || !!siteOrigin())
  const docs = docsOrigin()
  const token = invitationPath(invite) ? invite : undefined
  const ref = referralCode(referral)
  const billingNext = billingNextPath(nextTarget)
  const query = new URLSearchParams()
  if (token) query.set('invite', token)
  if (ref) query.set('ref', ref)
  if (billingNext) query.set('next', billingNext)
  const next = query.size ? '?' + query : ''
  return (
    <main className="account-screen account-screen-auth">
      <header className="account-header account-header-bordered">
        <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
        <div className="account-header-controls">
          {docs && <a className="account-link account-header-link" href={docs}>{marketing('docs')}</a>}
          <LocaleSwitcher />
        </div>
      </header>
      <div className="account-stage">
        <section className="account-showcase" aria-label={marketing('homeTitle')}>
          <p className="account-lead-title">{marketing('heroTitle')}</p>
          <p className="account-lead-body">{marketing('heroDescription')}</p>
          <figure className="account-specimen">
            <Image src="/early/writing.jpg" width={1220} height={760} sizes="(min-width: 880px) 520px, 1px" preload alt={marketing('writingAlt')} />
          </figure>
          <ul className="account-facts">
            <li>{marketing('moveFolders')}</li>
            <li>{marketing('moveLinks')}</li>
            <li>{marketing('moveExport')}</li>
          </ul>
        </section>
        <div className="account-column">
          <section className="account-card account-auth-card" data-enter aria-labelledby="account-title">
            <h1 id="account-title">{t(titles[mode])}</h1>
            {mode === 'forgot' && <p className="account-intro">{t('forgotIntro')}</p>}
            {notice === 'confirm' && <p className="account-error" role="alert">{t('confirmError')}</p>}
            {notice === 'signout' && <p className="account-error" role="alert">{t('signoutError')}</p>}
            {notice === 'google' && <p className="account-error" role="alert">{t('googleError')}</p>}
            {ready ? <AccountForm mode={mode} invite={token} referral={ref} nextTarget={billingNext ?? undefined}
              google={googleOAuthEnabled() && !!siteOrigin() && !ref && (mode === 'login' || mode === 'signup')}
              transfer={workspaceTransferPath(transfer) ? transfer : undefined} /> : <p className="account-unavailable" role="status">{t('unavailable')}</p>}
            <div className="account-links">
              {mode === 'login' && <Link href="/forgot-password">{t('forgot')}</Link>}
              {mode === 'login' && <Link href={'/signup' + next}>{t('signup')}</Link>}
              {mode !== 'login' && <Link href={'/login' + next}>{t('login')}</Link>}
            </div>
          </section>
          <nav className="account-legal" aria-label={marketing('footer')}>
            <Link href="/privacy-policy">{marketing('privacy')}</Link>
            <Link href="/terms-of-service">{marketing('terms')}</Link>
          </nav>
        </div>
      </div>
    </main>
  )
}
