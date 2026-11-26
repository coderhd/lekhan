import 'server-only'

import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  analyticsConsentCookie, analyticsId, billingMeasurementToken, ga4Configured, googleClientId,
  posthogClientId, posthogConfigured, posthogToken,
} from '@/lib/analytics-settings'
import { siteOrigin } from '@/lib/auth/config'
import type { Currency, Cycle, PaidTier } from './catalog'

const gaSecret = process.env.GA4_MEASUREMENT_API_SECRET?.trim()
const destinations = [
  ...(ga4Configured && gaSecret ? ['ga4' as const] : []),
  ...(posthogConfigured ? ['posthog' as const] : []),
]
type Destination = 'ga4' | 'posthog'
type MeasurementEvent = {
  id: string
  checkout_id: string
  event: 'checkout_completed' | 'billing_subscription_changed'
  tier: PaidTier
  cycle: Cycle
  currency: Currency
  status: 'active' | 'past_due' | 'incomplete' | 'canceled' | 'none'
  ends_at_renewal: boolean
  occurred_at: string
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex')
export const billingMeasurementEnabled = destinations.length > 0

export async function revokeCheckoutMeasurement(admin: SupabaseClient, token: string) {
  const { error } = await admin.rpc('rebuild_revoke_checkout_measurement', { consent: digest(token) })
  if (error) throw new Error('Billing measurement revocation unavailable')
}

export async function bindCheckoutMeasurement(admin: SupabaseClient, attempt: string, raw: unknown) {
  if (!billingMeasurementEnabled || !raw || typeof raw !== 'object') return
  const { token, gaClient, posthogClient } = raw as Record<string, unknown>
  if (typeof token !== 'string' || !billingMeasurementToken.test(token)) return
  if ((await cookies()).get(analyticsConsentCookie)?.value !== 'granted') return

  const ga = destinations.includes('ga4') && typeof gaClient === 'string' && googleClientId.test(gaClient) ? gaClient : null
  const posthog = destinations.includes('posthog') && typeof posthogClient === 'string' &&
    posthogClientId.test(posthogClient) ? posthogClient : null
  if (!ga && !posthog) return

  const { error } = await admin.rpc('rebuild_bind_checkout_measurement', {
    attempt, consent: digest(token), ga_client: ga, posthog_client: posthog,
  })
  if (error) throw new Error('Billing measurement binding unavailable')
}

async function deliverEvent(destination: Destination, event: MeasurementEvent, client: string, origin: string) {
  const context = { page_location: origin + '/billing', page_title: 'Lekhan', page_referrer: '' }
  const offer = { tier: event.tier, cycle: event.cycle, currency: event.currency }
  const properties = event.event === 'checkout_completed' ? { ...context, ...offer } : {
    ...context, ...offer, status: event.status, ends_at_renewal: event.ends_at_renewal ? 1 : 0,
  }

  const endpoint = destination === 'ga4'
    ? 'https://region1.google-analytics.com/mp/collect?' +
      new URLSearchParams({ measurement_id: analyticsId, api_secret: gaSecret ?? '' })
    : 'https://eu.i.posthog.com/i/v0/e/'
  const payload = destination === 'ga4' ? {
    client_id: client,
    timestamp_micros: Date.parse(event.occurred_at) * 1000,
    consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
    events: [{ name: event.event, params: { ...properties, event_id: event.id } }],
  } : {
    api_key: posthogToken,
    event: event.event,
    distinct_id: client,
    timestamp: event.occurred_at,
    properties: { ...properties, $insert_id: event.id, $process_person_profile: false },
  }
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(4000), redirect: 'error',
  })
  await response.body?.cancel()
  return response.ok ? 'sent' as const : 'failed' as const
}

async function sendClaimedEvent(admin: SupabaseClient, id: string, destination: Destination, origin: string) {
  const { data: event, error } = await admin.from('rebuild_billing_measurement_events')
    .select('id,checkout_id,event,tier,cycle,currency,status,ends_at_renewal,occurred_at')
    .eq('id', id).maybeSingle<MeasurementEvent>()
  if (error) throw new Error('Billing measurement event unavailable')
  if (!event) return 'skipped'
  // Read the binding again after claiming so a processed revocation wins.
  const { data: binding, error: bindingError } = await admin.from('rebuild_billing_measurement')
    .select('client_id').eq('checkout_id', event.checkout_id).eq('destination', destination)
    .gt('expires_at', new Date().toISOString()).maybeSingle<{ client_id: string }>()
  if (bindingError) throw new Error('Billing measurement binding unavailable')
  const outcome = binding
    ? await deliverEvent(destination, event, binding.client_id, origin).catch(() => 'failed' as const)
    : 'skipped'
  const saved = await admin.from('rebuild_billing_measurement_events').update({ outcome }).eq('id', id)
  if (saved.error) throw new Error('Billing measurement outcome unavailable')
  return outcome
}

export async function flushBillingMeasurement(admin: SupabaseClient, prune = false) {
  const origin = siteOrigin()
  let failures = 0
  if (!billingMeasurementEnabled || !origin) return { failures }
  for (const destination of destinations) {
    const { data, error } = await admin.rpc('rebuild_claim_billing_measurement', { target: destination, batch_size: 10 })
    if (error || !Array.isArray(data)) {
      failures++
      continue
    }
    for (let offset = 0; offset < data.length; offset += 5) {
      const outcomes = await Promise.allSettled(data.slice(offset, offset + 5).map((id: string) =>
        sendClaimedEvent(admin, id, destination, origin)))
      failures += outcomes.filter(result => result.status === 'rejected' || result.value === 'failed').length
    }
  }
  if (prune && (await admin.rpc('rebuild_prune_billing_measurement')).error) failures++
  return { failures }
}

export async function deliverBillingMeasurement(admin: SupabaseClient) {
  try {
    const { failures } = await flushBillingMeasurement(admin)
    if (failures) console.error('Billing measurement delivery failed', { failures })
  } catch {
    console.error('Billing measurement delivery unavailable')
  }
}
