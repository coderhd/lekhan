import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { accountContext } from '@/lib/auth/server'
import BillingPanel from '@/components/settings/billing-panel'
import { UsageAnalyticsControl } from '@/components/usage-analytics'

export const metadata = { title: 'Workspace billing · Lekhan' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; transfer?: string }> }) {
  const account = await accountContext()
  if (!account) redirect('/login')
  return <main className="billing-screen">
    <header className="account-header">
      <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <Link className="account-link billing-back" href="/cloud"><ArrowLeft size={15} /> Cloud workspace</Link>
    </header>
    <section className="billing-content">
      <h1>Workspace billing</h1>
      <BillingPanel account={account} query={await searchParams} />
      <UsageAnalyticsControl />
    </section>
  </main>
}
