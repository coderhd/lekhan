import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/faq', t('faq') + ' · Lekhan', t('faqIntro'))
}

export default async function FaqPage() {
  const t = await getTranslations('marketing')
  return <MarketingFrame current="faq">
    <section className="marketing-faq marketing-width" aria-labelledby="faq-title">
      <header className="marketing-lead" data-enter>
        <h1 id="faq-title">{t('faqTitle')}</h1>
        <p>{t('faqIntro')}</p>
        <Link href="/contact" className="marketing-text-link">{t('contact')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
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
