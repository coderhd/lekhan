import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { resolveLocale } from '@/lib/i18n/locales'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/about', resolveLocale(await getLocale()), t('about') + ' · Lekhan', t('aboutIntro'))
}

export default async function AboutPage() {
  const t = await getTranslations('marketing')
  return <MarketingFrame path="/about">
    <section className="marketing-about marketing-width" aria-labelledby="about-title">
      <header className="marketing-lead" data-enter>
        <h1 id="about-title">{t('aboutTitle')}</h1>
        <p>{t('aboutIntro')}</p>
      </header>
      <div className="marketing-split marketing-about-story">
        <figure className="marketing-shot"><Image src="/early/search.jpg" width={1220} height={760} sizes="(min-width: 900px) 53vw, 95vw" alt={t('searchAlt')} /></figure>
        <div className="marketing-copy">
          <h2>{t('aboutStoryTitle')}</h2>
          <p>{t('aboutStoryLocal')}</p>
          <p>{t('aboutStoryCloud')}</p>
          <Link href="/workspace" className="marketing-text-link">{t('startWriting')} <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>
  </MarketingFrame>
}
