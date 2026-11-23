import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerAdmin } from '@/lib/auth/admin'
import { siteOrigin } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'
import { ensureCloudWorkspace } from '@/lib/cloud/graph'
import type { Currency, Cycle, Offer, PaidTier } from './catalog'
import { entitlementFromRow, type WorkspacePlanRowLike } from './entitlements'
import {
  cancelProviderSubscription, checkoutAvailable, configuredPrice, providerManagementLink,
  railForCurrency, razorpaySchedule, resumeProviderCheckout, startProviderCheckout, verifyCheckoutPrice, type Rail,
} from './gateways'

interface PlanRow extends WorkspacePlanRowLike {
  workspace_id: string
  currency: Currency | null
  gateway: Rail | 'none'
  gateway_customer_id: string | null
  gateway_subscription_id: string | null
  rebuild_billing_revision: number
  rebuild_billing_price_id: string | null
  credited_months: number
}

export interface PendingCheckout {
  id: string
  workspace_id: string
  created_at: string
  rail: Rail
  tier: PaidTier
  cycle: Cycle
  seats: number
  price_id: string
  founding: boolean
  provider_ref: string | null
  status: 'creating' | 'open' | 'closed' | 'settled'
  expires_at: number
}

export const checkoutFields = 'id,workspace_id,created_at,rail,tier,cycle,seats,price_id,founding,provider_ref,status,expires_at'
const planFields = 'workspace_id,tier,billing_cycle,status,gateway,currency,gateway_customer_id,gateway_subscription_id,current_period_end,cancel_at_period_end,past_due_since,is_founding,seats,credited_months,rebuild_billing_revision,rebuild_billing_price_id'

export class BillingError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

export async function billingAccount() {
  const account = await accountContext()
  if (!account) throw new BillingError('sign_in_required', 401)
  const admin = createServerAdmin()
  const origin = siteOrigin()
  if (!admin || !origin) throw new BillingError('billing_unavailable', 503)
  return { account, admin, origin }
}

export async function ownerWorkspace(client: SupabaseClient, subject: string): Promise<string | null> {
  const { data, error } = await client.from('workspaces').select('id').eq('owner_id', subject).maybeSingle<{ id: string }>()
  if (error) throw new Error('Billing workspace lookup failed')
  return data?.id ?? null
}

export async function readBillingPlan(admin: SupabaseClient, workspaceId: string) {
  const { data, error } = await admin.from('workspace_plans').select(planFields)
    .eq('workspace_id', workspaceId).maybeSingle<PlanRow>()
  if (error) throw new Error('Billing plan lookup failed')
  return data
}

export async function withBillingMutation<T>(admin: SupabaseClient, plan: PlanRow, run: () => Promise<T>) {
  const now = new Date()
  const lease = new Date(now.getTime() + 75_000).toISOString()
  const { data, error } = await admin.from('workspace_plans').update({ rebuild_billing_write_until: lease })
    .eq('workspace_id', plan.workspace_id).eq('rebuild_billing_revision', plan.rebuild_billing_revision)
    .lte('rebuild_billing_write_until', now.toISOString()).select('workspace_id').maybeSingle()
  if (error) throw new Error('Could not reserve the billing change')
  if (!data) throw new BillingError('billing_busy', 409)
  try {
    return await run()
  } finally {
    await admin.from('workspace_plans').update({ rebuild_billing_write_until: new Date().toISOString() })
      .eq('workspace_id', plan.workspace_id).eq('rebuild_billing_write_until', lease)
  }
}

async function pendingCheckout(admin: SupabaseClient, workspaceId: string) {
  const { data, error } = await admin.from('rebuild_billing_checkouts')
    .select(checkoutFields)
    .eq('workspace_id', workspaceId).in('status', ['creating', 'open']).maybeSingle<PendingCheckout>()
  if (error) throw new Error('Pending checkout lookup failed')
  return data
}

export async function readBillingSummary(admin: SupabaseClient, workspaceId: string | null) {
  const [plan, pending] = workspaceId
    ? await Promise.all([readBillingPlan(admin, workspaceId), pendingCheckout(admin, workspaceId)])
    : [null, null] as const
  return {
    entitlement: plan ? entitlementFromRow(plan) : null,
    referralMonths: plan?.credited_months ?? 0,
    gateway: plan?.gateway ?? 'none',
    currency: plan?.currency ?? null,
    pending: pending ? {
      tier: pending.tier, cycle: pending.cycle, seats: pending.seats,
      currency: pending.rail === 'stripe' ? 'USD' as const : 'INR' as const,
    } : null,
    canManage: !!plan?.gateway_subscription_id && plan.status !== 'canceled',
  }
}

function sameOffer(offer: Offer, pending: PendingCheckout) {
  return pending.rail === railForCurrency(offer.currency) && pending.tier === offer.tier &&
    pending.cycle === offer.cycle && pending.seats === offer.seats
}

async function saveCheckout(admin: SupabaseClient, checkout: PendingCheckout, ref: string) {
  const { error } = await admin.from('rebuild_billing_checkouts').update({ status: 'open', provider_ref: ref })
    .eq('id', checkout.id).eq('status', 'creating')
  if (error) throw new Error('Could not record the hosted checkout')
}

export async function beginCheckout(context: Awaited<ReturnType<typeof billingAccount>>, offer: Offer) {
  const { admin, account, origin } = context
  const { id: workspaceId } = await ensureCloudWorkspace(account.client, account.subject)
  const plan = await readBillingPlan(admin, workspaceId)
  let pending = await pendingCheckout(admin, workspaceId)
  if (pending?.provider_ref) {
    const state = await resumeProviderCheckout(pending.rail, pending.provider_ref)
    if (!state.closed) {
      if (state.url && sameOffer(offer, pending)) return state.url
      throw new BillingError('checkout_in_progress', 409)
    }
    const { error } = await admin.from('rebuild_billing_checkouts').update({ status: 'closed' })
      .eq('id', pending.id).eq('status', 'open')
    if (error) throw new Error('Could not close the expired checkout')
    pending = null
  }

  if (plan?.gateway_subscription_id && plan.status !== 'canceled') throw new BillingError('subscription_exists', 409)
  const rail = railForCurrency(offer.currency)
  const founding = plan?.is_founding === true
  const priceId = configuredPrice(offer, founding)
  if (!priceId || !checkoutAvailable(offer, founding)) throw new BillingError('price_unavailable', 503)

  if (pending) {
    // Stripe reuses the exact idempotency key and parameters after an ambiguous response.
    // Razorpay cannot guarantee replay of a subscription creation request.
    if (pending.rail !== 'stripe' || !sameOffer(offer, pending) || pending.founding !== founding ||
      pending.price_id !== priceId || pending.expires_at <= Math.ceil(Date.now() / 1000)) {
      throw new BillingError('checkout_in_progress', 409)
    }
  } else {
    await verifyCheckoutPrice(offer, founding, priceId)
    const expiresAt = Math.ceil(Date.now() / 1000) + 2 * 3600
    const reservation = await admin.rpc('rebuild_reserve_billing_checkout', {
      target_workspace: workspaceId, actor: account.subject, offer_rail: rail, offer_tier: offer.tier,
      offer_cycle: offer.cycle, offer_seats: offer.seats, offer_price: priceId, offer_founding: founding, offer_expires: expiresAt,
    })
    if (reservation.error) {
      if (reservation.error.message === 'billing_checkout_in_progress') throw new BillingError('checkout_in_progress', 409)
      if (reservation.error.message === 'billing_subscription_exists') throw new BillingError('subscription_exists', 409)
      if (reservation.error.message === 'billing_offer_changed') throw new BillingError('offer_changed', 409)
      throw new Error('Could not reserve a checkout')
    }
    if (typeof reservation.data !== 'string') throw new Error('Missing checkout reservation')
    pending = {
      id: reservation.data, workspace_id: workspaceId, created_at: new Date().toISOString(),
      rail, tier: offer.tier, cycle: offer.cycle, seats: offer.seats, price_id: priceId,
      expires_at: expiresAt, founding, status: 'creating', provider_ref: null,
    }
  }

  const next = await startProviderCheckout({
    id: pending.id, workspaceId, offer, founding, priceId, expiresAt: pending.expires_at, origin,
    customerId: plan?.gateway === rail ? plan.gateway_customer_id : null,
  })
  await saveCheckout(admin, pending, next.ref)
  return next.url
}

export async function manageBilling(context: Awaited<ReturnType<typeof billingAccount>>, action: 'portal' | 'cancel') {
  const { account, admin, origin } = context
  const workspace = await ownerWorkspace(account.client, account.subject)
  const plan = workspace && await readBillingPlan(admin, workspace)
  if (!plan || plan.gateway === 'none' || !plan.gateway_subscription_id || plan.status === 'canceled') {
    throw new BillingError('no_subscription', 404)
  }
  if (action === 'portal') return providerManagementLink(
    plan.gateway, plan.gateway_subscription_id, plan.gateway_customer_id, origin, plan.is_founding === true,
  )

  const { gateway, gateway_subscription_id: ref } = plan
  if (!plan.cancel_at_period_end) await withBillingMutation(admin, plan, async () => {
    if (gateway === 'razorpay' && (await razorpaySchedule(ref)).paymentChange) {
      throw new BillingError('remove_scheduled_change', 409)
    }
    await cancelProviderSubscription(gateway, ref)
    const { error } = await admin.from('workspace_plans').update({ cancel_at_period_end: true })
      .eq('workspace_id', plan.workspace_id).eq('gateway_subscription_id', plan.gateway_subscription_id).neq('status', 'canceled')
    if (error) throw new Error('Could not record the cancellation request')
  })
  return null
}
