import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
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
  const [request, t, billing] = await Promise.all([
    headers(),
    getTranslations('billing'),
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
      {query.transfer === 'accepted' && <p role="status" className="billing-notice">{t('ownershipAccepted')}</p>}
      {summary ? <BillingSettings summary={summary} scope={'account:' + account.subject} defaultCurrency={currency} available={available}
        returned={query.checkout === 'returned'} paused={query.checkout === 'paused'} />
        : <p role="status">{t('panelUnavailable')}</p>}
      {summary && billing?.storage && <WorkspaceStorage images={billing.storage.image_bytes} files={billing.storage.file_bytes} free={(summary.entitlement?.tier ?? 'free') === 'free'} />}
      {summary && <section className="billing-referrals" aria-labelledby="billing-referrals">
        <h2 id="billing-referrals">{t('referrals')}</h2>
        <p>{t.rich('monthsBanked', { months: summary.referralMonths, count: text => <strong>{text}</strong> })}</p>
        <p>{t('referralEarn')}</p>
        {summary.gateway === 'stripe' && <p>{t('referralRenewal')}</p>}
        <InviteLink path={'/signup?' + new URLSearchParams({ ref: account.subject })} origin={siteOrigin()} label={t('referralLink')} />
      </section>}
      {billing?.workspace && <WorkspaceTransferInvite />}
    </div>
}
