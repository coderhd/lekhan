import 'server-only'

import Stripe from 'stripe'
import { teamBands, unitAmount, type Currency, type Cycle, type Offer, type PaidTier } from './catalog'

export type Rail = 'stripe' | 'razorpay'
export type ProviderStatus = 'active' | 'past_due' | 'incomplete' | 'canceled'

export interface Checkout {
  id: string
  workspaceId: string
  offer: Offer
  founding: boolean
  priceId: string
  expiresAt: number
  customerId: string | null
  origin: string
}

export interface Subscription {
  id: string
  customerId: string | null
  attemptId: string | undefined
  workspaceId: string | undefined
  status: ProviderStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string
  seats: number
}

interface RazorpaySubscription {
  id: string
  customer_id?: string
  plan_id: string
  quantity: number
  status: string
  current_end?: number
  change_scheduled_at?: number
  short_url?: string
  has_scheduled_changes?: boolean
  notes?: Record<string, string>
}

export function railForCurrency(currency: Currency): Rail {
  return currency === 'USD' ? 'stripe' : 'razorpay'
}

export function priceBinding(offer: Offer, founding: boolean) {
  const prefix = offer.currency === 'USD' ? 'STRIPE_PRICE' : 'RAZORPAY_PLAN'
  return [prefix, offer.tier.toUpperCase(), offer.cycle.toUpperCase(), founding ? 'FOUNDING' : 'GA', offer.currency].join('_')
}

export function configuredPrice(offer: Offer, founding: boolean) {
  const value = process.env[priceBinding(offer, founding)]?.trim()
  const pattern = offer.currency === 'USD' ? /^price_[a-z\d]+$/i : /^plan_[a-z\d]+$/i
  return value && pattern.test(value) ? value : null
}

export function checkoutAvailable(offer: Offer, founding: boolean) {
  const credentials = offer.currency === 'USD'
    ? process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
    : process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET
  return Boolean(credentials && configuredPrice(offer, founding))
}

export function findConfiguredOffer(rail: Rail, priceId: string, seats: number, founding: boolean): Offer | null {
  const currency: Currency = rail === 'stripe' ? 'USD' : 'INR'
  const tiers: PaidTier[] = currency === 'USD' ? ['plus', 'pro', 'team'] : ['plus', 'pro']
  const cycles: Cycle[] = ['monthly', 'annual']
  for (const tier of tiers) {
    for (const cycle of cycles) {
      const offer = { tier, cycle, currency, seats: tier === 'team' ? seats : 1 }
      if (configuredPrice(offer, founding) === priceId && (tier !== 'team' || seats >= 2)) return offer
    }
  }
  return null
}

let stripeConnection: { key: string; client: Stripe } | undefined

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw new Error('Stripe is unavailable')
  if (stripeConnection?.key !== key) {
    stripeConnection = { key, client: new Stripe(key, { apiVersion: Stripe.API_VERSION, timeout: 12_000, maxNetworkRetries: 1 }) }
  }
  return stripeConnection.client
}

class RazorpayError extends Error {
  constructor(readonly status: number, readonly updateUnsupported: boolean) {
    super('Razorpay request failed')
  }
}

async function razorpay<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const key = process.env.RAZORPAY_KEY_ID?.trim()
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!key || !secret) throw new Error('Razorpay is unavailable')
  const response = await fetch('https://api.razorpay.com/v1/' + path, {
    method,
    body: data ? JSON.stringify(data) : undefined,
    headers: {
      Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    const error = response.status === 400 && method === 'PATCH'
      ? await response.json().catch(() => null) as { error?: { description?: unknown } } | null : null
    const description = error?.error?.description
    throw new RazorpayError(response.status, typeof description === 'string' && /payment mode is UPI|e-?mandate/i.test(description))
  }
  return await response.json() as T
}

function hostedUrl(raw: string | null | undefined, rail: Rail) {
  if (!raw) throw new Error('No hosted payment URL')
  const url = new URL(raw)
  const hosts = rail === 'stripe' ? ['checkout.stripe.com', 'billing.stripe.com'] : ['rzp.io', 'pages.razorpay.com']
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.includes(url.hostname)) {
    throw new Error('Unrecognized hosted payment URL')
  }
  return url.href
}

function planPeriod(cycle: Cycle) {
  return cycle === 'monthly' ? 'month' : 'year'
}

export async function verifyCheckoutPrice(offer: Offer, founding: boolean, priceId: string) {
  const amount = unitAmount(offer, founding)
  if (offer.currency === 'USD') {
    const price = await stripeClient().prices.retrieve(priceId, { expand: ['tiers'] })
    if (!price.active || price.currency !== 'usd' || price.recurring?.interval !== planPeriod(offer.cycle) ||
      price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed') {
      throw new Error('Stripe price disagrees with the catalog')
    }
    if (offer.tier === 'team') {
      const cohort = founding ? 'founding' : 'standard'
      const factor = offer.cycle === 'annual' ? 10 : 1
      if (price.tiers_mode !== 'volume' || price.tiers?.length !== teamBands.length ||
        !teamBands.every((band, i) => {
          const step = price.tiers?.[i]
          return step?.up_to === band.through && step.unit_amount === band[cohort] * factor && !step.flat_amount
        })) throw new Error('Stripe team volume bands disagree with the catalog')
    } else if (price.unit_amount !== amount) throw new Error('Stripe amount disagrees with the catalog')
    return
  }

  const plan = await razorpay<{ period: string; interval: number; item: { currency: string; amount: number } }>('plans/' + priceId)
  const period = offer.cycle === 'monthly' ? 'monthly' : 'yearly'
  if (plan.period !== period || plan.interval !== 1 || plan.item.currency !== 'INR' || plan.item.amount !== amount) {
    throw new Error('Razorpay plan disagrees with the catalog')
  }
}

export async function startProviderCheckout(checkout: Checkout) {
  const { offer, workspaceId, id, expiresAt, priceId } = checkout
  const metadata = { workspace_id: workspaceId, lekhan_checkout_id: id, is_founding: String(checkout.founding) }
  if (offer.currency === 'USD') {
    const url = checkout.origin + '/billing'
    const session = await stripeClient().checkout.sessions.create({
      mode: 'subscription',
      expires_at: expiresAt,
      success_url: url + '?checkout=returned',
      cancel_url: url + '?checkout=paused',
      metadata,
      client_reference_id: workspaceId,
      subscription_data: { metadata },
      ...(checkout.customerId ? { customer: checkout.customerId } : {}),
      line_items: [{ price: priceId, quantity: offer.seats }],
    }, { idempotencyKey: 'lekhan-workspace-checkout-' + id })
    return { ref: session.id, url: hostedUrl(session.url, 'stripe') }
  }

  const subscription = await razorpay<RazorpaySubscription>('subscriptions', 'POST', {
    plan_id: priceId,
    total_count: offer.cycle === 'monthly' ? 120 : 10,
    quantity: 1,
    expire_by: expiresAt,
    customer_notify: true,
    notes: metadata,
  })
  return { ref: subscription.id, url: hostedUrl(subscription.short_url, 'razorpay') }
}

interface CheckoutBinding {
  id: string
  workspace_id: string
  expires_at: number
  created_at: string
  price_id: string
}

export async function findProviderCheckout(rail: Rail, binding: CheckoutBinding): Promise<string | null> {
  const from = Math.floor(Date.parse(binding.created_at) / 1000) - 60
  const to = Math.min(binding.expires_at + 60, Math.ceil(Date.now() / 1000))
  const matches = new Set<string>()
  const belongs = (metadata: Record<string, string> | null | undefined) =>
    metadata?.lekhan_checkout_id === binding.id && metadata.workspace_id === binding.workspace_id

  if (rail === 'stripe') {
    const stripe = stripeClient()
    let cursor: string | undefined
    for (let page = 0; page < 3; page++) {
      const result: Stripe.ApiList<Stripe.Checkout.Session> = await stripe.checkout.sessions.list({
        created: { gte: from, lte: to }, limit: 100, starting_after: cursor,
      })
      for (const session of result.data) if (belongs(session.metadata)) matches.add(session.id)
      if (!result.has_more) return uniqueCheckout(matches)
      cursor = result.data.at(-1)?.id
      if (!cursor) break
    }
  } else {
    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({
        plan_id: binding.price_id, from: String(from), to: String(to), count: '100', skip: String(page * 100),
      })
      const result = await razorpay<{ items: RazorpaySubscription[] }>('subscriptions?' + query)
      for (const subscription of result.items) if (belongs(subscription.notes)) matches.add(subscription.id)
      if (result.items.length < 100) return uniqueCheckout(matches)
    }
  }
  throw new Error('Provider checkout search exceeded the recovery window')
}

function uniqueCheckout(matches: Set<string>) {
  if (matches.size > 1) throw new Error('Multiple provider checkouts share a reservation')
  return matches.values().next().value ?? null
}

export async function resumeProviderCheckout(rail: Rail, ref: string, binding?: Pick<CheckoutBinding, 'id' | 'workspace_id'>) {
  if (rail === 'stripe') {
    if (!/^cs_[a-z\d_]+$/i.test(ref)) throw new Error('Invalid checkout reference')
    const session = await stripeClient().checkout.sessions.retrieve(ref)
    if (binding && (session.id !== ref || session.metadata?.lekhan_checkout_id !== binding.id ||
      session.metadata.workspace_id !== binding.workspace_id)) throw new Error('Stripe checkout does not match its reservation')
    if (session.status === 'expired') return { closed: true as const }
    return {
      closed: false as const, url: session.status === 'open' ? hostedUrl(session.url, rail) : null,
      subscription: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null,
    }
  }
  const subscription = await razorpaySubscription(ref)
  if (binding && (subscription.id !== ref || subscription.notes?.lekhan_checkout_id !== binding.id ||
    subscription.notes.workspace_id !== binding.workspace_id)) throw new Error('Razorpay checkout does not match its reservation')
  if (['expired', 'cancelled', 'completed'].includes(subscription.status)) return { closed: true as const }
  return { closed: false as const, url: subscription.status === 'created' ? hostedUrl(subscription.short_url, rail) : null, subscription: ref }
}

function razorpaySubscription(ref: string) {
  if (!/^sub_[a-z\d]+$/i.test(ref)) throw new Error('Invalid subscription reference')
  return razorpay<RazorpaySubscription>('subscriptions/' + ref)
}

export async function razorpaySchedule(ref: string) {
  const current = await razorpaySubscription(ref)
  if (current.id !== ref) throw new Error('Unexpected Razorpay subscription')
  const pending = current.has_scheduled_changes
    ? await razorpay<RazorpaySubscription>('subscriptions/' + ref + '/retrieve_scheduled_changes') : null
  if (pending && (pending.id !== ref || !pending.plan_id)) throw new Error('Unexpected Razorpay scheduled change')
  return {
    currentPrice: current.plan_id,
    active: current.status === 'active',
    paymentChange: pending && {
      priceId: pending.plan_id,
      effectiveAt: iso(current.change_scheduled_at) ?? iso(pending.change_scheduled_at) ?? iso(current.current_end),
    },
  }
}

export async function scheduleRazorpayPlan(ref: string, priceId: string) {
  try {
    await razorpay('subscriptions/' + ref, 'PATCH', {
      plan_id: priceId, schedule_change_at: 'cycle_end', customer_notify: true,
    })
  } catch (error) {
    if (error instanceof RazorpayError && error.updateUnsupported) return false
    throw error
  }
  return true
}

export async function cancelRazorpayPlanChange(ref: string) {
  await razorpay('subscriptions/' + ref + '/cancel_scheduled_changes', 'POST')
}

function iso(timestamp?: number) {
  return typeof timestamp === 'number' && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null
}

export async function readSubscription(rail: Rail, ref: string): Promise<Subscription> {
  if (rail === 'stripe') {
    if (!/^sub_[a-z\d]+$/i.test(ref)) throw new Error('Invalid subscription reference')
    const source = await stripeClient().subscriptions.retrieve(ref)
    const [item] = source.items.data
    if (!item || source.items.data.length !== 1 || source.items.has_more) throw new Error('Unexpected subscription items')
    let status: ProviderStatus
    if (source.status === 'active' || source.status === 'trialing') status = 'active'
    else if (source.status === 'past_due' || source.status === 'unpaid') status = 'past_due'
    else if (source.status === 'canceled' || source.status === 'incomplete_expired') status = 'canceled'
    else if (source.status === 'incomplete' || source.status === 'paused') status = 'incomplete'
    else throw new Error('Unexpected Stripe subscription state')
    return {
      id: source.id,
      customerId: typeof source.customer === 'string' ? source.customer : source.customer.id,
      workspaceId: source.metadata.workspace_id,
      attemptId: source.metadata.lekhan_checkout_id,
      priceId: item.price.id,
      seats: item.quantity ?? 1,
      status,
      currentPeriodEnd: iso(item.current_period_end),
      cancelAtPeriodEnd: source.cancel_at_period_end,
    }
  }
  const source = await razorpaySubscription(ref)
  let status: ProviderStatus
  if (source.status === 'active') status = 'active'
  else if (source.status === 'pending' || source.status === 'halted') status = 'past_due'
  else if (['cancelled', 'completed', 'expired'].includes(source.status)) status = 'canceled'
  else if (['created', 'authenticated', 'paused'].includes(source.status)) status = 'incomplete'
  else throw new Error('Unexpected Razorpay subscription state')
  return {
    id: source.id,
    customerId: source.customer_id ?? null,
    workspaceId: source.notes?.workspace_id,
    attemptId: source.notes?.lekhan_checkout_id,
    priceId: source.plan_id,
    seats: source.quantity,
    status,
    currentPeriodEnd: iso(source.current_end),
    cancelAtPeriodEnd: false,
  }
}

export async function providerManagementLink(
  rail: Rail, subscriptionId: string, customerId: string | null, origin: string, founding: boolean,
) {
  if (rail === 'stripe') {
    if (!customerId || !/^cus_[a-z\d]+$/i.test(customerId)) throw new Error('Missing Stripe customer')
    const binding = founding ? 'STRIPE_PORTAL_CONFIGURATION_FOUNDING' : 'STRIPE_PORTAL_CONFIGURATION_GA'
    const configuration = process.env[binding]?.trim()
    if (!configuration || !/^bpc_[a-z\d]+$/i.test(configuration)) throw new Error('Stripe portal is unavailable')
    const stripe = stripeClient()
    const { active, features } = await stripe.billingPortal.configurations.retrieve(configuration)
    const updates = features.subscription_update
    if (!active || (features.subscription_cancel.enabled && features.subscription_cancel.mode !== 'at_period_end')) {
      throw new Error('Stripe portal configuration is incompatible')
    }
    if (updates.enabled) {
      const products = updates.products
      if (updates.default_allowed_updates.includes('promotion_code') || !products?.length || products.some(product =>
        !product.prices.length || product.prices.some(id => {
          const offer = findConfiguredOffer('stripe', id, 2, founding)
          return !offer || (product.adjustable_quantity?.enabled &&
            (offer.tier !== 'team' || product.adjustable_quantity.minimum < 2))
        }),
      )) throw new Error('Stripe portal offers are incompatible with the workspace pricing')
    }
    const session = await stripe.billingPortal.sessions.create({ configuration, customer: customerId, return_url: origin + '/billing' })
    return hostedUrl(session.url, 'stripe')
  }
  return hostedUrl((await razorpaySubscription(subscriptionId)).short_url, 'razorpay')
}

export async function cancelProviderSubscription(rail: Rail, subscriptionId: string) {
  if (!/^sub_[a-z\d]+$/i.test(subscriptionId)) throw new Error('Invalid subscription reference')
  if (rail === 'stripe') {
    await stripeClient().subscriptions.update(subscriptionId, { cancel_at_period_end: true })
    return
  }
  await razorpay('subscriptions/' + subscriptionId + '/cancel', 'POST', { cancel_at_cycle_end: true })
}
