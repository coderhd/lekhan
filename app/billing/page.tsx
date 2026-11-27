import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { accountContext } from '@/lib/auth/server'
import BillingPanel from '@/components/settings/billing-panel'

export async function generateMetadata() {
  const t = await getTranslations('billing')
  return { title: t('title') + ' · Lekhan' }
}

export default async function BillingPage({ searchParams }: {
  searchParams: Promise<{ checkout?: string; transfer?: string; tier?: string; cycle?: string; currency?: string; seats?: string }>
}) {
  const query = await searchParams
  const account = await accountContext()
  if (!account) {
    const returnParams = new URLSearchParams()
    if (query.tier === 'plus' || query.tier === 'pro' || query.tier === 'team') returnParams.set('tier', query.tier)
    if (query.cycle === 'monthly' || query.cycle === 'annual') returnParams.set('cycle', query.cycle)
    if (query.currency === 'USD' || query.currency === 'INR') returnParams.set('currency', query.currency)
    if (query.seats && /^\d+$/.test(query.seats)) returnParams.set('seats', query.seats)
    const next = returnParams.size ? `/billing?${returnParams}` : '/billing'
    redirect('/login?' + new URLSearchParams({ next }))
  }
  const [t, cloud] = await Promise.all([getTranslations('billing'), getTranslations('cloud-workspace')])
  return <main className="billing-screen">
    <header className="account-header">
      <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <Link className="account-link billing-back" href="/cloud"><ArrowLeft size={15} /> {cloud('title')}</Link>
    </header>
    <section className="billing-content">
      <h1>{t('title')}</h1>
      <BillingPanel account={account} query={query} />
    </section>
  </main>
}
