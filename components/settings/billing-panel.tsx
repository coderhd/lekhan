import { headers } from 'next/headers'
import { accountContext } from '@/lib/auth/server'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import type { Currency, Cycle, PaidTier } from '@/lib/billing/catalog'
import { checkoutAvailable } from '@/lib/billing/gateways'
import { ownerWorkspace, readBillingSummary } from '@/lib/billing/workspace'
import BillingSettings from '@/components/billing-settings'
import InviteLink from '@/components/invite-link'
import { WorkspaceTransferInvite } from '@/components/workspace-transfer'
import WorkspaceStorage from '@/components/workspace-storage'

export default async function BillingPanel({ account, query = {} }: {
  account: NonNullable<Awaited<ReturnType<typeof accountContext>>>
  query?: { checkout?: string; transfer?: string }
}) {
  const admin = createServerAdmin()
  const [request, billing] = await Promise.all([
    headers(),
    admin && siteOrigin()
      ? ownerWorkspace(account.client, account.subject)
        .then(async workspace => {
          const [summary, usage] = await Promise.all([
            readBillingSummary(admin, workspace),
            workspace ? admin.rpc('rebuild_workspace_media_summary', { target_workspace: workspace, actor: account.subject }) : null,
          ])
          const storage = usage?.data
          return { workspace, summary, storage: typeof storage?.image_bytes === 'number' && typeof storage?.file_bytes === 'number' ? storage : null }
        }).catch(() => null)
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

  return <div className="settings-billing">
      {query.transfer === 'accepted' && <p role="status" className="billing-notice">You now own this workspace.</p>}
      {summary ? <BillingSettings summary={summary} defaultCurrency={currency} available={available}
        returned={query.checkout === 'returned'} paused={query.checkout === 'paused'} />
        : <p role="status">Billing is temporarily unavailable. You can still open your workspace and keep writing.</p>}
      {summary && billing?.storage && <WorkspaceStorage images={billing.storage.image_bytes} files={billing.storage.file_bytes} free={(summary.entitlement?.tier ?? 'free') === 'free'} />}
      {summary && <section className="billing-referrals" aria-labelledby="billing-referrals">
        <h2 id="billing-referrals">Referrals</h2>
        <p><strong>{summary.referralMonths}</strong> {summary.referralMonths === 1 ? 'month' : 'months'} banked</p>
        <p>Earn a month when a friend starts a cloud workspace and another when they first subscribe.</p>
        {summary.gateway === 'stripe' && <p>At renewal, banked months become Stripe credit toward a future invoice.</p>}
        <InviteLink path={'/signup?' + new URLSearchParams({ ref: account.subject })} origin={siteOrigin()} label="Referral link" />
      </section>}
      {billing?.workspace && <WorkspaceTransferInvite />}
    </div>
}
