import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { findProviderCheckout, resumeProviderCheckout } from './gateways'
import { reconcileProviderSubscription, retryBillingWebhook } from './webhooks'
import { checkoutFields, ownerWorkspace, readBillingPlan, type billingAccount, type PendingCheckout } from './workspace'

async function reconcileCheckout(admin: SupabaseClient, checkout: PendingCheckout) {
  const ref = checkout.provider_ref ?? await findProviderCheckout(checkout.rail, checkout)
  if (!ref) return checkout.expires_at <= Math.floor(Date.now() / 1000) ? 'unlocated' : 'pending'

  const state = await resumeProviderCheckout(checkout.rail, ref, checkout)
  if (!checkout.provider_ref || state.closed) {
    const { error } = await admin.from('rebuild_billing_checkouts')
      .update({ status: state.closed ? 'closed' : 'open', provider_ref: ref })
      .eq('id', checkout.id).in('status', ['creating', 'open'])
    if (error) throw new Error('Could not update recovered checkout')
  }
  if (state.closed) return 'closed'
  if (state.subscription) {
    const outcome = await reconcileProviderSubscription(admin, checkout.rail, state.subscription, checkout)
    if (outcome !== 'pending') return outcome
  }
  return checkout.provider_ref ? 'pending' : 'recovered'
}

export async function refreshWorkspaceCheckout(context: Awaited<ReturnType<typeof billingAccount>>) {
  const { admin, account } = context
  const workspace = await ownerWorkspace(account.client, account.subject)
  if (!workspace) return 'unchanged'
  const now = new Date()
  const { data: checkout, error } = await admin.from('rebuild_billing_checkouts')
    .update({ rebuild_owner_check_after: new Date(now.getTime() + 30_000).toISOString() })
    .eq('workspace_id', workspace).in('status', ['creating', 'open'])
    .lte('rebuild_owner_check_after', now.toISOString()).select(checkoutFields).maybeSingle<PendingCheckout>()
  if (error) throw new Error('Could not check workspace checkout')
  return checkout ? reconcileCheckout(admin, checkout) : 'unchanged'
}

const batchSizes = { webhook: 10, checkout: 12, subscription: 40 } as const
type WorkKind = keyof typeof batchSizes

async function processWork(admin: SupabaseClient, kind: WorkKind, id: string) {
  if (kind === 'webhook') return retryBillingWebhook(admin, id)
  const nextCheck = new Date(Date.now() + 18 * 3600_000).toISOString()
  if (kind === 'checkout') {
    const { data: checkout, error } = await admin.from('rebuild_billing_checkouts').select(checkoutFields)
      .eq('id', id).in('status', ['creating', 'open']).maybeSingle<PendingCheckout>()
    if (error) throw new Error('Checkout lookup failed')
    if (!checkout) return 'unchanged'
    const result = await reconcileCheckout(admin, checkout)
    const { error: scheduleError } = await admin.from('rebuild_billing_checkouts').update({ rebuild_poll_after: nextCheck })
      .eq('id', id).in('status', ['creating', 'open'])
    if (scheduleError) throw new Error('Could not schedule the next checkout check')
    return result
  }

  const plan = await readBillingPlan(admin, id)
  if (!plan?.gateway_subscription_id || plan.gateway === 'none' || plan.status === 'canceled') return 'unchanged'
  const result = await reconcileProviderSubscription(admin, plan.gateway, plan.gateway_subscription_id)
  if (result === 'ignored') throw new Error('Provider could not confirm the linked subscription')
  const { error } = await admin.from('workspace_plans').update({
    rebuild_poll_after: nextCheck, last_checked_at: new Date().toISOString(),
  }).eq('workspace_id', id).eq('gateway_subscription_id', plan.gateway_subscription_id)
  if (error) throw new Error('Could not schedule the next subscription check')
  return result
}

export async function reconcileBilling(admin: SupabaseClient) {
  const work: { kind: WorkKind; id: string }[] = []
  const summary = { checked: 0, updated: 0, pending: 0, unlocated: 0, failures: 0, deferred: 0 }
  const deadline = Date.now() + 200_000

  for (const kind of ['webhook', 'checkout', 'subscription'] as const) {
    const { data, error } = await admin.rpc('rebuild_claim_billing_work', { kind, batch_size: batchSizes[kind] })
    if (error || !Array.isArray(data)) {
      summary.failures++
      continue
    }
    work.push(...data.map((id: string) => ({ kind, id })))
  }

  for (let offset = 0; offset < work.length; offset += 8) {
    if (Date.now() >= deadline) {
      summary.deferred = work.length - offset
      break
    }
    const group = work.slice(offset, offset + 8)
    const results = await Promise.allSettled(group.map(({ kind, id }) => processWork(admin, kind, id)))
    summary.checked += group.length
    for (const result of results) {
      if (result.status === 'rejected') summary.failures++
      else if (result.value === 'applied' || result.value === 'closed' || result.value === 'recovered') summary.updated++
      else if (result.value === 'pending') summary.pending++
      else if (result.value === 'unlocated') summary.unlocated++
    }
  }
  return summary
}
