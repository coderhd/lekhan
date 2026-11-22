import { ArrowUpRight, Github, Mail } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/contact', t('contact') + ' · Lekhan', t('contactIntro'))
}

export default async function ContactPage() {
  const t = await getTranslations('marketing')
  return <MarketingFrame current="contact">
    <section className="marketing-contact marketing-width" aria-labelledby="contact-title">
      <header className="marketing-lead" data-enter>
        <h1 id="contact-title">{t('contactTitle')}</h1>
        <p>{t('contactIntro')}</p>
      </header>
      <div className="marketing-contact-options">
        <a href="mailto:harshdave1094@gmail.com">
          <Mail size={23} aria-hidden="true" />
          <span><strong>{t('emailTitle')}</strong><small>{t('emailBody')}</small></span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
        <a href="https://github.com/coderhd/lekhan/issues">
          <Github size={23} aria-hidden="true" />
          <span><strong>{t('githubTitle')}</strong><small>{t('githubBody')}</small></span>
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </div>
    </section>
  </MarketingFrame>
}
