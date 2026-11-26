import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { accountContext } from '@/lib/auth/server'
import BillingPanel from '@/components/settings/billing-panel'
import { UsageAnalyticsControl } from '@/components/usage-analytics'

export async function generateMetadata() {
  const t = await getTranslations('billing')
  return { title: t('title') + ' · Lekhan' }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; transfer?: string }> }) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const [t, cloud] = await Promise.all([getTranslations('billing'), getTranslations('cloud-workspace')])
  return <main className="billing-screen">
    <header className="account-header">
      <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <Link className="account-link billing-back" href="/cloud"><ArrowLeft size={15} /> {cloud('title')}</Link>
    </header>
    <section className="billing-content">
      <h1>{t('title')}</h1>
      <BillingPanel account={account} query={await searchParams} />
      <UsageAnalyticsControl />
    </section>
  </main>
}
