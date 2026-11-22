import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import LocaleSwitcher from './locale-switcher'

const marketingLinks = { about: '/about', faq: '/faq', contact: '/contact' } as const

export default async function MarketingFrame({ children, current }: { children: ReactNode; current?: keyof typeof marketingLinks }) {
  const t = await getTranslations('marketing')
  return <div className="marketing-site">
    <a className="marketing-skip" href="#marketing-main">{t('skip')}</a>
    <header className="marketing-header marketing-width">
      <Link href="/" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <nav aria-label={t('navigation')}>
        {(['about', 'faq', 'contact'] as const).map(item => <Link
          aria-current={current === item ? 'page' : undefined} key={item} href={marketingLinks[item]}>{t(item)}</Link>)}
      </nav>
      <Link href="/workspace" className="marketing-header-action">{t('workspace')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </header>
    <main id="marketing-main" tabIndex={-1}>{children}</main>
    <footer className="marketing-footer marketing-width">
      <Link href="/" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <nav aria-label={t('footer')}>
        <Link href="/early">{t('early')}</Link>
        <Link href="/privacy-policy">{t('privacy')}</Link>
        <Link href="/terms-of-service">{t('terms')}</Link>
      </nav>
      <LocaleSwitcher />
    </footer>
  </div>
}
