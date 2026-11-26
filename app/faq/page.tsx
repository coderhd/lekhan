import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { resolveLocale } from '@/lib/i18n/locales'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'
import { marketingLink } from '@/lib/marketing/routes'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/faq', resolveLocale(await getLocale()), t('faq') + ' · Lekhan', t('faqIntro'))
}

export default async function FaqPage() {
  const [t, language] = await Promise.all([getTranslations('marketing'), getLocale()])
  const locale = resolveLocale(language)
  return <MarketingFrame path="/faq">
    <section className="marketing-faq marketing-width" aria-labelledby="faq-title">
      <header className="marketing-lead" data-enter>
        <h1 id="faq-title">{t('faqTitle')}</h1>
        <p>{t('faqIntro')}</p>
        <Link href={marketingLink('/contact', locale)} className="marketing-text-link">{t('contact')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </header>
      <div className="marketing-questions">
        {(['transfer', 'storage', 'sharing', 'provider', 'export'] as const).map(item => <details key={item} id={item} open={item === 'transfer' || undefined}>
          <summary>{t(item + 'Question')} <Plus size={17} aria-hidden="true" /></summary>
          <p>{t(item + 'Answer')}</p>
        </details>)}
      </div>
    </section>
  </MarketingFrame>
}
