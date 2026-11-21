import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { authConfig, siteOrigin } from '@/lib/auth/config'
import type { AuthMode } from '@/lib/auth/input'
import { AccountForm } from './account-form'
import LocaleSwitcher from './locale-switcher'

export default async function AccountScreen({ mode, notice }: {
  mode: AuthMode
  notice?: string
}) {
  const t = await getTranslations('auth')
  const titles = { login: 'login', signup: 'signup', forgot: 'forgot', reset: 'reset' } as const
  const ready = !!authConfig() && ((mode === 'login' || mode === 'reset') || !!siteOrigin())
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
        {ready ? <AccountForm mode={mode} /> : <p role="status">{t('unavailable')}</p>}
        <div className="account-links">
          {mode === 'login' && <Link href="/forgot-password">{t('forgot')}</Link>}
          {mode === 'login' && <Link href="/signup">{t('signup')}</Link>}
          {mode !== 'login' && <Link href="/login">{t('login')}</Link>}
          <Link href="/">{t('localWorkspace')}</Link>
        </div>
      </section>
    </main>
  )
}
