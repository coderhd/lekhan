import 'server-only'

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { createServerAdmin } from '@/lib/auth/admin'
import { uuidPattern } from '@/lib/cloud/graph'
import { readBoundedBody } from '@/lib/server/read-body'
import { readOffer, type Offer } from './catalog'
import { findConfiguredOffer, providerRenewalStopped, readSubscription, stripeClient, type Rail } from './gateways'
import { readBillingPlan } from './workspace'
import { redeemStripeInvoice } from './stripe-referrals'
import { billingMeasurementEnabled, deliverBillingMeasurement } from './measurement'

interface Event {
  key: string
  type: string
  body: unknown
  subscription: string | null
  invoice?: string
}

const stripeCheckoutEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
])
const stripeSubscriptionEvents = new Set([
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
])
const stripeInvoiceEvents = new Set(['invoice.paid', 'invoice.payment_failed'])
const razorpaySubscriptionEvents = new Set([
  'subscription.authenticated', 'subscription.activated', 'subscription.charged',
  'subscription.updated', 'subscription.pending', 'subscription.halted', 'subscription.completed',
  'subscription.cancelled', 'subscription.paused', 'subscription.resumed',
])

function reference(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id ?? null
}

function stripeEvent(payload: Buffer, signature: string, secret: string): Event {
  return stripePointer(stripeClient().webhooks.constructEvent(payload, signature, secret))
}

function stripePointer(body: Stripe.Event): Event {
  let subscription = null
  let renewalInvoice: string | undefined
  if (stripeCheckoutEvents.has(body.type)) {
    subscription = reference((body.data.object as Stripe.Checkout.Session).subscription)
  } else if (stripeSubscriptionEvents.has(body.type)) {
    subscription = (body.data.object as Stripe.Subscription).id
  } else if (stripeInvoiceEvents.has(body.type)) {
    const invoice = body.data.object as Stripe.Invoice
    subscription = reference(invoice.parent?.subscription_details?.subscription)
    if (body.type === 'invoice.paid') renewalInvoice = invoice.id
  }
  return { key: 'stripe:' + body.id, type: body.type, body, subscription, invoice: renewalInvoice }
}

function razorpayEvent(payload: Buffer, signature: string, secret: string): Event {
  if (!/^[a-f0-9]{64}$/i.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, 'hex'), createHmac('sha256', secret).update(payload).digest())) {
    throw new Error('Invalid Razorpay signature')
  }
  return razorpayPointer(JSON.parse(payload.toString('utf8')), 'razorpay:' + createHash('sha256').update(payload).digest('hex'))
}

function razorpayPointer(raw: unknown, key: string): Event {
  const body = raw as {
    event?: string
    payload?: { subscription?: { entity?: { id?: string } } }
  }
  if (typeof body?.event !== 'string') throw new Error('Invalid Razorpay event')
  const subscription = razorpaySubscriptionEvents.has(body.event) ? body.payload?.subscription?.entity?.id ?? null : null
  return { key, type: body.event, body, subscription }
}

async function markProcessed(admin: SupabaseClient, key: string) {
  const { error } = await admin.from('gateway_events').update({ processed_at: new Date().toISOString() })
    .eq('event_id', key).is('processed_at', null)
  if (error) throw new Error('Billing event could not be marked processed')
}

async function readLinkedWorkspace(admin: SupabaseClient, rail: Rail, subscription: string) {
  const { data, error } = await admin.from('workspace_plans').select('workspace_id').eq('gateway', rail)
    .eq('gateway_subscription_id', subscription).maybeSingle<{ workspace_id: string }>()
  if (error) throw new Error('Could not resolve a billing workspace')
  return data?.workspace_id
}

async function recordEvent(admin: SupabaseClient, rail: Rail, event: Event) {
  const { error: recordError } = await admin.from('gateway_events').upsert({
    event_id: event.key, gateway: rail, type: event.type, payload: event.body,
  }, { onConflict: 'event_id', ignoreDuplicates: true })
  if (recordError) throw new Error('Billing event could not be recorded')
}

type Result = 'applied' | 'pending' | 'ignored' | 'duplicate' | 'unchanged'

class BillingRevisionChanged extends Error {}

async function applyWithFreshReadback(...args: Parameters<typeof applyProviderState>) {
  try {
    return await applyProviderState(...args)
  } catch (error) {
    if (!(error instanceof BillingRevisionChanged)) throw error
    return applyProviderState(...args)
  }
}

async function applyRecordedEvent(admin: SupabaseClient, rail: Rail, event: Event): Promise<Result> {
  const { data: audit, error: auditError } = await admin.from('gateway_events').select('processed_at')
    .eq('event_id', event.key).single<{ processed_at: string | null }>()
  if (auditError) throw new Error('Billing event lookup failed')
  if (audit.processed_at) return 'duplicate'

  if (typeof event.subscription !== 'string' || !/^sub_[a-z\d]+$/i.test(event.subscription)) {
    await markProcessed(admin, event.key)
    return 'ignored'
  }
  return applyWithFreshReadback(admin, rail, event.subscription, event.key)
}

async function handleRecordedEvent(admin: SupabaseClient, rail: Rail, event: Event) {
  const result = await applyRecordedEvent(admin, rail, event)
  if (rail === 'stripe' && event.invoice && event.subscription) {
    const redemption = await redeemStripeInvoice(admin, event.invoice, event.subscription)
    if (redemption === 'applied') return redemption
  }
  return result
}

async function applyProviderState(
  admin: SupabaseClient, rail: Rail, ref: string, recordedKey?: string,
  reservation?: { id: string; workspace_id: string },
): Promise<Result> {
  async function ignore() {
    if (recordedKey) await markProcessed(admin, recordedKey)
    return 'ignored' as const
  }

  const linked = await readLinkedWorkspace(admin, rail, ref)
  const target = linked ?? reservation?.workspace_id ?? (await readSubscription(rail, ref)).workspaceId
  if (!target || !uuidPattern.test(target)) return ignore()

  const plan = await readBillingPlan(admin, target)
  const provider = await readSubscription(rail, ref)
  if (reservation && (provider.workspaceId !== reservation.workspace_id || provider.attemptId !== reservation.id)) {
    throw new Error('Provider subscription does not match the recovered checkout')
  }
  if (!plan || provider.id !== ref || (provider.workspaceId && provider.workspaceId !== target)) return ignore()

  const attemptKey = provider.attemptId && uuidPattern.test(provider.attemptId) ? provider.attemptId : null
  const attempt = attemptKey ? await admin.from('rebuild_billing_checkouts').select('rail,tier,cycle,seats,price_id,founding')
    .eq('workspace_id', target).eq('id', attemptKey).maybeSingle() : null
  if (attempt?.error) throw new Error('Checkout lookup failed')

  if (!linked && (!attempt?.data || attempt.data.rail !== rail)) return ignore()

  const successor = !linked && plan.rebuild_successor_founding != null
  if (successor && provider.status === 'active' && plan.status !== 'canceled' &&
    plan.gateway_subscription_id && plan.gateway !== 'none' &&
    !await providerRenewalStopped(plan.gateway, plan.gateway_subscription_id, plan.cancel_at_period_end === true)) {
    throw new Error('Predecessor renewal is still enabled')
  }

  const currency = rail === 'stripe' ? 'USD' : 'INR'
  const founding = successor ? plan.rebuild_successor_founding : plan.is_founding
  const offerFromAttempt = !linked && attempt?.data && attempt.data.price_id === provider.priceId && attempt.data.founding === founding
    ? readOffer({ ...attempt.data, currency, seats: provider.seats })
    : null
  const existingOffer = linked && plan.rebuild_billing_price_id === provider.priceId
    ? readOffer({ ...plan, cycle: plan.billing_cycle, currency, seats: provider.seats })
    : null
  const offer: Offer | null = offerFromAttempt ?? existingOffer ??
    findConfiguredOffer(rail, provider.priceId, provider.seats, founding === true) ??
    (linked && provider.status === 'canceled' ? { tier: 'plus', cycle: 'monthly', currency, seats: 1 } : null)
  if (!offer) throw new Error('Provider subscription price is unrecognized')
  if (provider.status !== 'canceled' && provider.seats !== offer.seats) throw new Error('Provider quantity is inconsistent')

  const retainsPaidTier = provider.status !== 'canceled'
  const unchanged = linked && plan.gateway_subscription_id === provider.id &&
    plan.status === provider.status && plan.currency === currency &&
    plan.tier === (retainsPaidTier ? offer.tier : 'free') &&
    plan.billing_cycle === (retainsPaidTier ? offer.cycle : 'none') &&
    plan.seats === (retainsPaidTier && offer.tier === 'team' ? offer.seats : null) &&
    plan.rebuild_billing_price_id === provider.priceId &&
    (plan.rebuild_successor_founding != null || !provider.customerId || plan.gateway_customer_id === provider.customerId) &&
    (plan.current_period_end ? Date.parse(String(plan.current_period_end)) : null) ===
      (provider.currentPeriodEnd ? Date.parse(provider.currentPeriodEnd) : null) &&
    plan.cancel_at_period_end === (retainsPaidTier && (provider.cancelAtPeriodEnd ||
      (rail === 'razorpay' && plan.cancel_at_period_end === true))) &&
    (provider.status === 'past_due' ? !!plan.past_due_since : !plan.past_due_since)
  if (unchanged) {
    if (recordedKey) await markProcessed(admin, recordedKey)
    return 'unchanged'
  }

  const synthetic = !recordedKey
  if (!recordedKey) {
    if (!linked && provider.status !== 'active' && provider.status !== 'canceled') return 'pending'
    recordedKey = 'reconcile:' + randomUUID()
    await recordEvent(admin, rail, {
      key: recordedKey, type: 'reconcile.subscription', subscription: ref, body: { subscription_id: ref },
    })
  }

  const { data, error } = await admin.rpc('rebuild_apply_billing_event', {
    event_key: recordedKey, target_workspace: target, attempt_key: attemptKey,
    expected_revision: plan.rebuild_billing_revision, provider_rail: rail, provider_subscription: provider.id,
    provider_customer: provider.customerId, provider_price: provider.priceId,
    provider_status: provider.status, provider_period_end: provider.currentPeriodEnd,
    provider_cancel_at_end: provider.cancelAtPeriodEnd, offer_tier: offer.tier, offer_cycle: offer.cycle, offer_seats: offer.seats,
  })
  if (error?.message === 'billing_revision_changed') {
    if (synthetic) await markProcessed(admin, recordedKey)
    throw new BillingRevisionChanged()
  }
  if (error) throw new Error('Billing event application must be retried')
  if (data === 'applied' || data === 'pending' || data === 'ignored' || data === 'duplicate') return data
  throw new Error('Unknown billing event result')
}

export async function reconcileProviderSubscription(
  admin: SupabaseClient, rail: Rail, ref: string, reservation?: { id: string; workspace_id: string },
) {
  return applyWithFreshReadback(admin, rail, ref, undefined, reservation)
}

export async function retryBillingWebhook(admin: SupabaseClient, id: string) {
  const { data, error } = await admin.from('gateway_events').select('event_id,gateway,payload,processed_at')
    .eq('id', id).maybeSingle<{ event_id: string; gateway: Rail; payload: unknown; processed_at: string | null }>()
  if (error) throw new Error('Billing webhook lookup failed')
  if (!data || data.processed_at) return 'duplicate'
  if (data.gateway === 'stripe' && data.event_id.startsWith('stripe:')) {
    const event = stripePointer(data.payload as Stripe.Event)
    if (event.key !== data.event_id) throw new Error('Stored Stripe webhook ID mismatch')
    return handleRecordedEvent(admin, 'stripe', event)
  }
  if (data.gateway === 'razorpay' && data.event_id.startsWith('razorpay:')) {
    return applyRecordedEvent(admin, 'razorpay', razorpayPointer(data.payload, data.event_id))
  }
  return 'ignored'
}

export async function receiveBillingWebhook(request: Request, rail: Rail) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const secret = (rail === 'stripe' ? process.env.STRIPE_WEBHOOK_SECRET : process.env.RAZORPAY_WEBHOOK_SECRET)?.trim()
  const admin = createServerAdmin()
  if (!secret || !admin) return Response.json({ error: 'billing_unavailable' }, { status: 503, headers })

  const signature = request.headers.get(rail === 'stripe' ? 'stripe-signature' : 'x-razorpay-signature')
  if (!signature) return Response.json({ error: 'missing_signature' }, { status: 400, headers })
  const payload = await readBoundedBody(request, 512 * 1024).catch(() => null)
  if (!payload) return Response.json({ error: 'invalid_payload' }, { status: 400, headers })

  let event: Event
  try {
    event = rail === 'stripe' ? stripeEvent(payload, signature, secret) : razorpayEvent(payload, signature, secret)
  } catch {
    return Response.json({ error: 'invalid_webhook' }, { status: 400, headers })
  }

  try {
    await recordEvent(admin, rail, event)
    const result = await handleRecordedEvent(admin, rail, event)
    if (result === 'applied' && billingMeasurementEnabled) after(() => deliverBillingMeasurement(admin))
    return Response.json({ received: true }, { headers })
  } catch {
    return Response.json({ error: 'billing_event_pending' }, { status: 503, headers })
  }
}
