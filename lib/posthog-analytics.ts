'use client'

import posthog from 'posthog-js/dist/module.slim'
import { posthogHost, posthogToken } from './analytics-settings'
import { readTierGateBootstrap, type TierGateFlagMap } from './tier-gate-flags'

let initialized = false
let latestBootstrap: TierGateFlagMap = readTierGateBootstrap('personal')

// Keep our event contract and the anonymous IDs required for PostHog's funnels.
const allowedProperties = new Set([
  'page_location', 'page_title', 'page_referrer', 'method', 'kind', 'is_first',
  'source', 'pages_bucket', 'degraded_blocks_bucket', 'format', 'gate',
  'tier', 'cycle', 'currency',
  'token', 'distinct_id', '$device_id', '$session_id', '$insert_id', '$process_person_profile',
])

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function ensureClient(allowed: () => boolean) {
  if (!allowed()) return false
  if (!initialized) {
    posthog.init(posthogToken, {
      api_host: posthogHost,
      defaults: '2026-08-30',
      persistence: 'localStorage',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      save_campaign_params: false,
      save_referrer: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: isOffline(),
      bootstrap: { featureFlags: latestBootstrap },
      opt_out_capturing_by_default: true,
      opt_out_useragent_filter: process.env.NODE_ENV === 'development',
      request_batching: false,
      before_send: event => {
        if (!event || !allowed() || event.event.startsWith('$')) return null
        const properties = Object.fromEntries(
          Object.entries(event.properties ?? {}).filter(([key]) => allowedProperties.has(key)),
        )
        return { uuid: event.uuid, event: event.event, timestamp: event.timestamp, properties }
      },
    })
    initialized = true
  }
  return true
}

export function captureProductEvent(
  name: string,
  properties: Record<string, unknown>,
  allowed: () => boolean,
  bootstrap?: TierGateFlagMap,
) {
  if (bootstrap) latestBootstrap = bootstrap
  if (!ensureClient(allowed)) return
  if (bootstrap) posthog.updateFlags(bootstrap, undefined, { merge: true })
  if (!posthog.has_opted_in_capturing()) posthog.opt_in_capturing({ captureEventName: false })
  const leavingForCheckout = name === 'upgrade_clicked' || name === 'checkout_started'
  posthog.capture(name, properties, leavingForCheckout ? { send_instantly: true, transport: 'sendBeacon' } : undefined)
}

export function syncTierGateBootstrap(flags: TierGateFlagMap, allowed: () => boolean) {
  latestBootstrap = flags
  if (!allowed() || !ensureClient(allowed)) return
  posthog.updateFlags(flags, undefined, { merge: true })
}

export function refreshTierGateFlags(allowed: () => boolean) {
  if (!initialized || !allowed() || isOffline()) return false
  posthog.set_config({ advanced_disable_flags: false })
  posthog.reloadFeatureFlags()
  return true
}

export function revokeProductAnalytics() {
  if (!initialized) return
  posthog.updateFlags(latestBootstrap)
  if (!posthog.has_opted_out_capturing()) posthog.opt_out_capturing()
}

export function billingAnalyticsId() {
  return initialized && posthog.has_opted_in_capturing() ? posthog.get_distinct_id() : undefined
}
