import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { ArrowLeft } from 'lucide-react'
import { accountContext } from '@/lib/auth/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import type { Currency, Cycle, PaidTier } from '@/lib/billing/catalog'
import { checkoutAvailable } from '@/lib/billing/gateways'
import { ownerWorkspace, readBillingSummary } from '@/lib/billing/workspace'
import BillingSettings from '@/components/billing-settings'

export const metadata = { title: 'Workspace billing · Lekhan' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const admin = createServerAdmin()
  const [[request, query], summary] = await Promise.all([
    Promise.all([headers(), searchParams]),
    admin && siteOrigin()
      ? ownerWorkspace(account.client, account.subject).then(id => readBillingSummary(admin, id)).catch(() => null)
      : null,
  ])
  const india = request.get('x-vercel-ip-country') === 'IN'
  const currency = summary?.pending?.currency ?? summary?.currency ?? (india ? 'INR' : 'USD')
  const founding = summary?.entitlement?.isFounding === true
  const currencies: Currency[] = ['USD', 'INR']
  const cycles: Cycle[] = ['monthly', 'annual']
  const tiers: PaidTier[] = ['plus', 'pro', 'team']
  const available = summary ? currencies.flatMap(currency => tiers.flatMap(tier => cycles.flatMap(cycle =>
    checkoutAvailable({ currency, tier, cycle, seats: 2 }, founding) && !(currency === 'INR' && tier === 'team')
      ? [`${currency}:${tier}:${cycle}`] : [],
  ))) : []

  return <main className="billing-screen">
    <header className="account-header">
      <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <Link className="account-link billing-back" href="/cloud"><ArrowLeft size={15} /> Cloud workspace</Link>
    </header>
    <section className="billing-content">
      <h1>Workspace billing</h1>
      {summary ? <BillingSettings summary={summary} defaultCurrency={currency} available={available}
        returned={query.checkout === 'returned'} paused={query.checkout === 'paused'} />
        : <p role="status">Billing is temporarily unavailable. You can still open your workspace and keep writing.</p>}
    </section>
  </main>
}
