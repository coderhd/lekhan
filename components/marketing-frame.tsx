import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { docsOrigin } from '@/lib/auth/config'
import { resolveLocale } from '@/lib/i18n/locales'
import { marketingLink, type MarketingPath } from '@/lib/marketing/routes'
import LocaleSwitcher from './locale-switcher'
import { UsageAnalyticsControl } from './usage-analytics'

const marketingLinks = { about: '/about', faq: '/faq', contact: '/contact' } as const

export default async function MarketingFrame({ children, path }: { children: ReactNode; path?: MarketingPath }) {
  const [t, locale] = await Promise.all([getTranslations('marketing'), getLocale()])
  const link = (target: MarketingPath) => marketingLink(target, resolveLocale(locale))
  const docs = docsOrigin()
  return <div className="marketing-site">
    <a className="marketing-skip" href="#marketing-main">{t('skip')}</a>
    <header className="marketing-header marketing-width">
      <Link href={link('/')} className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <nav aria-label={t('navigation')}>
        {(['about', 'faq', 'contact'] as const).map(item => <Link
          aria-current={path === marketingLinks[item] ? 'page' : undefined} key={item} href={link(marketingLinks[item])}>{t(item)}</Link>)}
      </nav>
      <Link href="/workspace" className="marketing-header-action">{t('workspace')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </header>
    <main id="marketing-main" tabIndex={-1}>{children}</main>
    <footer className="marketing-footer marketing-width">
      <Link href={link('/')} className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <nav aria-label={t('footer')}>
        <Link href="/early">{t('early')}</Link>
        {docs && <a href={docs}>{t('docs')}</a>}
        <Link href="/privacy-policy">{t('privacy')}</Link>
        <Link href="/terms-of-service">{t('terms')}</Link>
      </nav>
      <LocaleSwitcher path={path} />
      <UsageAnalyticsControl />
    </footer>
  </div>
}
