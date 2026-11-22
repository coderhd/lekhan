import 'server-only'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { createServerAdmin } from '@/lib/auth/admin'
import { uuidPattern } from '@/lib/cloud/graph'
import { readBoundedBody } from '@/lib/server/read-body'
import { readOffer, type Offer } from './catalog'
import { findConfiguredOffer, readSubscription, stripeClient, type Rail } from './gateways'
import { readBillingPlan } from './workspace'

interface Event {
  key: string
  type: string
  body: unknown
  subscription: string | null
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
  const body = stripeClient().webhooks.constructEvent(payload, signature, secret)
  let subscription = null
  if (stripeCheckoutEvents.has(body.type)) {
    subscription = reference((body.data.object as Stripe.Checkout.Session).subscription)
  } else if (stripeSubscriptionEvents.has(body.type)) {
    subscription = (body.data.object as Stripe.Subscription).id
  } else if (stripeInvoiceEvents.has(body.type)) {
    const invoice = body.data.object as Stripe.Invoice
    subscription = reference(invoice.parent?.subscription_details?.subscription)
  }
  return { key: 'stripe:' + body.id, type: body.type, body, subscription }
}

function razorpayEvent(payload: Buffer, signature: string, secret: string): Event {
  if (!/^[a-f0-9]{64}$/i.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, 'hex'), createHmac('sha256', secret).update(payload).digest())) {
    throw new Error('Invalid Razorpay signature')
  }
  const body = JSON.parse(payload.toString('utf8')) as {
    event?: string
    payload?: { subscription?: { entity?: { id?: string } } }
  }
  if (typeof body?.event !== 'string') throw new Error('Invalid Razorpay event')
  const subscription = razorpaySubscriptionEvents.has(body.event) ? body.payload?.subscription?.entity?.id ?? null : null
  const key = 'razorpay:' + createHash('sha256').update(payload).digest('hex')
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

async function applyEvent(admin: SupabaseClient, rail: Rail, event: Event) {
  const { error: recordError } = await admin.from('gateway_events').upsert({
    event_id: event.key, gateway: rail, type: event.type, payload: event.body,
  }, { onConflict: 'event_id', ignoreDuplicates: true })
  if (recordError) throw new Error('Billing event could not be recorded')

  const { data: audit, error: auditError } = await admin.from('gateway_events').select('processed_at')
    .eq('event_id', event.key).single<{ processed_at: string | null }>()
  if (auditError) throw new Error('Billing event lookup failed')
  if (audit.processed_at) return

  const ref = event.subscription
  if (typeof ref !== 'string' || !/^sub_[a-z\d]+$/i.test(ref)) {
    await markProcessed(admin, event.key)
    return
  }

  const linked = await readLinkedWorkspace(admin, rail, ref)
  const target = linked ?? (await readSubscription(rail, ref)).workspaceId
  if (!target || !uuidPattern.test(target)) {
    await markProcessed(admin, event.key)
    return
  }

  const plan = await readBillingPlan(admin, target)
  const provider = await readSubscription(rail, ref)
  if (!plan || provider.id !== ref || (provider.workspaceId && provider.workspaceId !== target)) {
    await markProcessed(admin, event.key)
    return
  }

  const attemptKey = provider.attemptId && uuidPattern.test(provider.attemptId) ? provider.attemptId : null
  const attempt = attemptKey ? await admin.from('rebuild_billing_checkouts').select('rail,tier,cycle,seats,price_id,founding')
    .eq('workspace_id', target).eq('id', attemptKey).maybeSingle() : null
  if (attempt?.error) throw new Error('Checkout lookup failed')

  if (!linked && (!attempt?.data || attempt.data.rail !== rail)) {
    await markProcessed(admin, event.key)
    return
  }

  const currency = rail === 'stripe' ? 'USD' : 'INR'
  const offerFromAttempt = !linked && attempt?.data && attempt.data.price_id === provider.priceId && attempt.data.founding === plan.is_founding
    ? readOffer({ ...attempt.data, currency, seats: provider.seats })
    : null
  const existingOffer = linked && plan.rebuild_billing_price_id === provider.priceId
    ? readOffer({ ...plan, cycle: plan.billing_cycle, currency, seats: provider.seats })
    : null
  const offer: Offer | null = offerFromAttempt ?? existingOffer ??
    findConfiguredOffer(rail, provider.priceId, provider.seats, plan.is_founding === true) ??
    (linked && provider.status === 'canceled' ? { tier: 'plus', cycle: 'monthly', currency, seats: 1 } : null)
  if (!offer) throw new Error('Provider subscription price is unrecognized')
  if (provider.status !== 'canceled' && provider.seats !== offer.seats) throw new Error('Provider quantity is inconsistent')

  const { error } = await admin.rpc('rebuild_apply_billing_event', {
    event_key: event.key, target_workspace: target, attempt_key: attemptKey,
    expected_revision: plan.rebuild_billing_revision, provider_rail: rail, provider_subscription: provider.id,
    provider_customer: provider.customerId, provider_price: provider.priceId,
    provider_status: provider.status, provider_period_end: provider.currentPeriodEnd,
    provider_cancel_at_end: provider.cancelAtPeriodEnd, offer_tier: offer.tier, offer_cycle: offer.cycle, offer_seats: offer.seats,
  })
  if (error) throw new Error('Billing event application must be retried')
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
    await applyEvent(admin, rail, event)
    return Response.json({ received: true }, { headers })
  } catch {
    return Response.json({ error: 'billing_event_pending' }, { status: 503, headers })
  }
}
