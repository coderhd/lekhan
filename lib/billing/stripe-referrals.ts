import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { readOffer, unitAmount } from './catalog'
import { stripeClient } from './gateways'
import { readBillingPlan } from './workspace'

interface Redemption {
  id: string
  workspace_id: string | null
  customer_ref: string
  months: number
  amount_minor: number
  attempted_at: string | null
  settled_at: string | null
  abandoned_at: string | null
}

const retryWindow = 23 * 3600_000

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id
}

function verifyTransaction(transaction: Stripe.CustomerBalanceTransaction, batch: Redemption) {
  if (transaction.type !== 'adjustment' || idOf(transaction.customer) !== batch.customer_ref ||
    transaction.currency !== 'usd' || transaction.amount !== -batch.amount_minor ||
    transaction.metadata?.lekhan_referral_redemption !== batch.id) throw new Error('Stripe credit does not match its reservation')
  return transaction.id
}

async function findPostedCredit(stripe: Stripe, batch: Redemption, attemptedAt: string) {
  const cutoff = Math.floor(Date.parse(attemptedAt) / 1000) - 60
  let cursor: string | undefined
  for (let page = 0; page < 3; page++) {
    const result: Stripe.ApiList<Stripe.CustomerBalanceTransaction> = await stripe.customers.listBalanceTransactions(batch.customer_ref, {
      limit: 100, starting_after: cursor,
    })
    const match = result.data.find(item => item.metadata?.lekhan_referral_redemption === batch.id)
    if (match) return verifyTransaction(match, batch)
    const oldest = result.data.at(-1)
    if (!result.has_more || (oldest && oldest.created < cutoff)) return null
    if (!oldest) break
    cursor = oldest.id
  }
  throw new Error('Stripe referral search exceeded its recovery window')
}

export async function recoverStripeReferral(admin: SupabaseClient, id: string) {
  const { data: batch, error } = await admin.from('rebuild_referral_redemptions')
    .select('id,workspace_id,customer_ref,months,amount_minor,attempted_at,settled_at,abandoned_at').eq('id', id).maybeSingle<Redemption>()
  if (error) throw new Error('Referral redemption lookup failed')
  if (!batch || batch.settled_at || batch.abandoned_at) return 'unchanged' as const

  const stripe = stripeClient()
  let providerRef = batch.attempted_at ? await findPostedCredit(stripe, batch, batch.attempted_at) : null
  if (!providerRef) {
    // A persisted attempt can outlive Stripe's key retention. Only a verified
    // provider-side posting can settle that batch once the safe retry window ends.
    if (batch.attempted_at && Date.now() - Date.parse(batch.attempted_at) >= retryWindow) {
      throw new Error('Stripe credit outcome requires review')
    }
    const start = await admin.rpc('rebuild_start_referral_redemption', { batch: id })
    if (start.error) throw new Error('Could not record the Stripe referral attempt')
    if (typeof start.data !== 'string') {
      const release = await admin.rpc('rebuild_release_unstarted_redemption', { batch: id })
      if (release.error) throw new Error('Could not release an unstarted referral reservation')
      return release.data === true ? 'closed' as const : 'pending' as const
    }
    if (Date.now() - Date.parse(start.data) >= retryWindow) throw new Error('Stripe credit outcome requires review')

    const transaction = await stripe.customers.createBalanceTransaction(batch.customer_ref, {
      amount: -batch.amount_minor,
      currency: 'usd',
      description: 'Lekhan referral credit',
      metadata: { lekhan_referral_redemption: batch.id, referral_months: String(batch.months) },
    }, { idempotencyKey: 'lekhan-referral-credit-' + batch.id })
    providerRef = verifyTransaction(transaction, batch)
  }

  const settled = await admin.rpc('rebuild_settle_referral_redemption', { batch: id, transaction_ref: providerRef })
  if (settled.error || settled.data !== true) throw new Error('Failed to settle verified Stripe credit')
  return 'applied' as const
}

function renewal(invoice: Stripe.Invoice) {
  return invoice.status === 'paid' && invoice.billing_reason === 'subscription_cycle' &&
    invoice.currency === 'usd' && !!invoice.status_transitions?.paid_at
}

async function redeemOnVerifiedInvoice(admin: SupabaseClient, invoice: Stripe.Invoice, workspace: string) {
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
  const customer = idOf(invoice.customer)
  if (!renewal(invoice) || !subscriptionId || !customer || !invoice.id) return 'unchanged' as const
  const plan = await readBillingPlan(admin, workspace)
  if (!plan?.credited_months || plan.gateway !== 'stripe' || plan.status !== 'active' ||
    plan.gateway_subscription_id !== subscriptionId || plan.gateway_customer_id !== customer) return 'unchanged' as const
  const monthly = readOffer({ ...plan, cycle: 'monthly', currency: 'USD' })
  if (!monthly) return 'unchanged' as const

  const claim = await admin.rpc('rebuild_reserve_referral_redemption', {
    target_workspace: workspace, target_subscription: subscriptionId, target_customer: customer,
    target_invoice: invoice.id, paid_at: new Date(invoice.status_transitions.paid_at! * 1000).toISOString(),
    amount_per_month: unitAmount(monthly, plan.is_founding === true) * monthly.seats,
    expected_revision: plan.rebuild_billing_revision,
  })
  if (claim.error) throw new Error('Could not reserve the referral balance')
  return typeof claim.data === 'string' ? recoverStripeReferral(admin, claim.data) : 'unchanged' as const
}

export async function redeemStripeInvoice(admin: SupabaseClient, ref: string, subscription: string) {
  if (!/^in_[a-z\d]+$/i.test(ref)) return
  const matched = await admin.from('workspace_plans').select('workspace_id')
    .eq('gateway', 'stripe').eq('gateway_subscription_id', subscription).gt('credited_months', 0)
    .maybeSingle<{ workspace_id: string }>()
  if (matched.error) throw new Error('Could not resolve the referral balance')
  if (!matched.data) return
  const invoice = await stripeClient().invoices.retrieve(ref)
  if (invoice.id !== ref || idOf(invoice.parent?.subscription_details?.subscription) !== subscription) return
  return redeemOnVerifiedInvoice(admin, invoice, matched.data.workspace_id)
}

export async function reconcileStripeRenewal(admin: SupabaseClient, workspace: string, subscription: string) {
  const { data } = await stripeClient().invoices.list({ subscription, status: 'paid', limit: 10 })
  const invoice = data.find(item => renewal(item) && idOf(item.parent?.subscription_details?.subscription) === subscription)
  return invoice ? redeemOnVerifiedInvoice(admin, invoice, workspace) : 'unchanged' as const
}
