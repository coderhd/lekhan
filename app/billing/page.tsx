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
import InviteLink from '@/components/invite-link'
import { WorkspaceTransferInvite } from '@/components/workspace-transfer'

export const metadata = { title: 'Workspace billing · Lekhan' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string; transfer?: string }> }) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const admin = createServerAdmin()
  const [[request, query], billing] = await Promise.all([
    Promise.all([headers(), searchParams]),
    admin && siteOrigin()
      ? ownerWorkspace(account.client, account.subject)
        .then(async workspace => ({ workspace, summary: await readBillingSummary(admin, workspace) })).catch(() => null)
      : null,
  ])
  const summary = billing?.summary
  const india = request.get('x-vercel-ip-country') === 'IN'
  const currency = summary?.pending?.currency ?? summary?.currency ?? (india ? 'INR' : 'USD')
  const founding = summary?.checkoutFounding === true
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
      {query.transfer === 'accepted' && <p role="status" className="billing-notice">You now own this workspace.</p>}
      {summary ? <BillingSettings summary={summary} defaultCurrency={currency} available={available}
        returned={query.checkout === 'returned'} paused={query.checkout === 'paused'} />
        : <p role="status">Billing is temporarily unavailable. You can still open your workspace and keep writing.</p>}
      {summary && <section className="billing-referrals" aria-labelledby="billing-referrals">
        <h2 id="billing-referrals">Referrals</h2>
        <p><strong>{summary.referralMonths}</strong> {summary.referralMonths === 1 ? 'month' : 'months'} banked</p>
        <p>Earn a month when a friend starts a cloud workspace and another when they first subscribe.</p>
        {summary.gateway === 'stripe' && <p>At renewal, banked months become Stripe credit toward a future invoice.</p>}
        <InviteLink path={'/signup?' + new URLSearchParams({ ref: account.subject })} origin={siteOrigin()} label="Referral link" />
      </section>}
      {billing?.workspace && <WorkspaceTransferInvite />}
    </section>
  </main>
}
