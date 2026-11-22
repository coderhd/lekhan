import Image from 'next/image'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { ArrowRight, Check, MoveUpRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import EarlyAccessAnalytics from '@/components/early-access-analytics'
import { analyticsConfigured } from '@/lib/analytics-settings'
import { authConfig } from '@/lib/auth/config'
import { FOUNDING_CAP, WAITLIST_RECEIPT } from '@/lib/waitlist/input'
import { receiptSecret, readWaitlistReceipt } from '@/lib/waitlist/receipt'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('early-access')
  return { title: t('join') + ' · Lekhan', description: t('positioning') }
}

export default async function EarlyAccess({ searchParams }: {
  searchParams: Promise<{ joined?: string; error?: string; ref?: string; utm_source?: string }>
}) {
  const [query, t, jar] = await Promise.all([searchParams, getTranslations('early-access'), cookies()])
  const secret = receiptSecret()
  const raw = jar.get(WAITLIST_RECEIPT)?.value
  const receipt = raw && secret && query.joined === '1' ? readWaitlistReceipt(secret, raw) : null
  const configured = !!authConfig() && !!secret && !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  const actionQuery = new URLSearchParams()
  if (typeof query.ref === 'string') actionQuery.set('ref', query.ref.slice(0, 100))
  if (typeof query.utm_source === 'string') actionQuery.set('utm_source', query.utm_source.slice(0, 100))
  const action = '/api/waitlist' + (actionQuery.size ? '?' + actionQuery : '')
  const issue = query.error === 'invalid' || query.error === 'too_many' || query.error === 'unavailable' ? query.error : null

  return <main className="early-screen">
    <div className="early-inner">
      <header className="early-header">
        <Link href="/" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
        <Link className="account-link" href="/workspace">{t('openWorkspace')} <MoveUpRight size={14} aria-hidden="true" /></Link>
      </header>
      <section className="early-hero">
        <div className="early-intro">
          <h1>{t('title')}</h1>
          <p>{t('positioning')}</p>
        </div>
        <div className="early-signup">
          {receipt ? <div role="status" className="early-receipt">
            <Check size={24} aria-hidden="true" />
            <h2>{receipt.position <= FOUNDING_CAP ? t('foundingSpot', { position: receipt.position, cap: FOUNDING_CAP }) : t('queueSpot', { position: receipt.position })}</h2>
            <p>{t('checkInbox')}</p>
          </div> : <>
            <h2>{t('join')}</h2>
            <p>{t('cohort', { cap: FOUNDING_CAP })}</p>
            {issue && <p role="alert" className="account-error">{t(issue)}</p>}
            {configured ? <form className="account-form" action={action} method="post">
              <label>{t('email')}<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
              <label>{t('useCase')}<textarea name="use_case" rows={2} maxLength={500} /></label>
              <button className="primary-button">{t('submit')} <ArrowRight size={17} aria-hidden="true" /></button>
              <p className="early-form-note">{t('confirmationNote')}</p>
            </form> : <p role="status">{t('unavailable')}</p>}
          </>}
        </div>
      </section>

      <section className="early-gallery" aria-labelledby="early-gallery-title">
        <h2 id="early-gallery-title">{t('workspace')}</h2>
        <div className="early-pictures">
          {(['writing', 'search', 'import'] as const).map(item => <figure key={item}>
            <Image src={'/early/' + item + '.jpg'} width={1220} height={760} alt={t(item + 'Alt')} sizes="(min-width: 920px) 33vw, (min-width: 610px) 50vw, 94vw" />
            <figcaption>{t(item)}</figcaption>
          </figure>)}
        </div>
      </section>
      {analyticsConfigured && <footer><EarlyAccessAnalytics signup={receipt ? receipt.event : null} /></footer>}
    </div>
  </main>
}
