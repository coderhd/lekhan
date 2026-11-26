import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { resolveLocale } from '@/lib/i18n/locales'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'
import { marketingLink } from '@/lib/marketing/routes'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/', resolveLocale(await getLocale()), t('homeTitle'), t('heroDescription'))
}

export default async function HomePage() {
  const [t, language] = await Promise.all([getTranslations('marketing'), getLocale()])
  const locale = resolveLocale(language)
  return <MarketingFrame path="/">
    <section className="marketing-hero marketing-width" aria-labelledby="marketing-title">
      <div className="marketing-hero-copy" data-enter>
        <h1 id="marketing-title">{t('heroTitle')}</h1>
        <p>{t('heroDescription')}</p>
        <div className="marketing-actions">
          <Link href="/workspace" className="primary-button">{t('startWriting')} <ArrowRight size={16} aria-hidden="true" /></Link>
          <Link href="/early" className="marketing-text-link">{t('early')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
      <figure className="marketing-shot marketing-hero-shot">
        <Image src="/early/writing.jpg" width={1220} height={760} sizes="(min-width: 900px) 60vw, 95vw" preload alt={t('writingAlt')} />
      </figure>
    </section>

    <section className="marketing-move" aria-labelledby="marketing-move-title">
      <div className="marketing-width marketing-split">
        <figure className="marketing-shot">
          <Image src="/early/import.jpg" width={1220} height={760} sizes="(min-width: 900px) 54vw, 95vw" alt={t('importAlt')} />
        </figure>
        <div className="marketing-copy">
          <h2 id="marketing-move-title">{t('moveTitle')}</h2>
          <p>{t('moveIntro')}</p>
          <ul className="marketing-proof">
            <li>{t('moveFolders')}</li>
            <li>{t('moveLinks')}</li>
            <li>{t('moveExport')}</li>
          </ul>
          <Link href={marketingLink('/faq', locale) + '#transfer'} className="marketing-text-link">{t('migrationDetails')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
    </section>

    <section className="marketing-principles marketing-width" aria-label={t('principles')}>
      <h2>{t('principlesTitle')}</h2>
      <dl>
        {(['local', 'collaboration', 'ai'] as const).map(item => <div key={item}>
          <dt>{t(item + 'Title')}</dt><dd>{t(item + 'Body')}</dd>
        </div>)}
      </dl>
    </section>
  </MarketingFrame>
}
