'use client'

import { wikiLinks } from './markdown-references'
import { localizedMarketingRoute, marketingPaths } from './marketing/routes'
import type { Currency, Cycle, PaidTier } from './billing/catalog'
import {
  analyticsConfigured, analyticsConsentCookie, analyticsId as id, analyticsPreference, analyticsReceipts,
  billingMeasurementToken, ga4Configured, googleClientId, posthogClientId, posthogConfigured,
} from './analytics-settings'
import {
  deriveTierGateFlags, readTierGateBootstrap, writeTierGateBootstrap,
  type TierGateFlagMap, type TierGatePlanInput,
} from './tier-gate-flags'

type ImportSource = 'obsidian' | 'markdown'
type ProviderKind = 'byok' | 'byol' | 'free_preset'
type GoogleTag = (...args: unknown[]) => void
const disableKey = 'ga-disable-' + id
let productAnalytics: ReturnType<typeof loadProductAnalytics> | undefined
let lastMarketingPath: string | null = null
let latestTierFlags: TierGateFlagMap | undefined
const measurementKey = analyticsPreference + ':billing-consent'
const revokeKey = analyticsPreference + ':billing-revocation'
let revoking: Promise<void> | undefined

function loadProductAnalytics() {
  return import('./posthog-analytics')
}
type Event =
  | ['early_access_signup']
  | ['signup_started' | 'signup_completed', 'email' | 'google']
  | ['workspace_created', 'local' | 'cloud']
  | ['page_created' | 'link_created', boolean]
  | ['import_completed', ImportSource, number]
  | ['import_report_viewed', ImportSource, number]
  | ['export_triggered', 'markdown' | 'md_zip']
  | ['ai_provider_connected', ProviderKind]
  | ['ai_message_sent' | 'daily_active_edit']
  | ['paywall_hit', 'history' | 'collaborators' | 'sync']
  | ['upgrade_clicked' | 'checkout_started', PaidTier, Cycle, Currency]

function browser() {
  return window as Window & { dataLayer?: unknown[]; gtag?: GoogleTag }
}

export function analyticsAllowed() {
  try { return analyticsConfigured && localStorage.getItem(analyticsPreference) === 'granted' } catch { return false }
}

export function syncAnalyticsConsent(allowed: boolean) {
  if (!analyticsConfigured) return
  if (!allowed) revokeBillingMeasurement()
  const cookie = analyticsConsentCookie + '=granted'
  const stored = document.cookie.split('; ').includes(cookie)
  if (stored === allowed) return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = cookie + '; Path=/; SameSite=Lax; Max-Age=' + (allowed ? 365 * 86400 : 0) + secure
}

function revokeBillingMeasurement() {
  try {
    const token = localStorage.getItem(measurementKey)
    if (token) {
      localStorage.setItem(revokeKey, token)
      localStorage.removeItem(measurementKey)
    }
    const pending = localStorage.getItem(revokeKey)
    if (!pending || revoking) return
    revoking = fetch('/api/analytics/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pending }), keepalive: true,
    }).then(response => {
      if (response.ok && localStorage.getItem(revokeKey) === pending) localStorage.removeItem(revokeKey)
    }).catch(() => undefined).finally(() => { revoking = undefined })
  } catch { /* Browser storage may be unavailable. */ }
}

export async function billingMeasurement() {
  if (!analyticsAllowed()) return undefined
  try {
    if (localStorage.getItem(revokeKey)) {
      revokeBillingMeasurement()
      return undefined
    }
    const ga = ga4Configured ? new Promise<string | undefined>(resolve => {
      const timeout = window.setTimeout(resolve, 250)
      enableUsageAnalytics()('get', id, 'client_id', (value: unknown) => {
        window.clearTimeout(timeout)
        resolve(typeof value === 'string' && googleClientId.test(value) ? value : undefined)
      })
    }) : undefined
    const posthog = productAnalytics && Promise.race([
      productAnalytics.then(sdk => sdk.billingAnalyticsId()).catch(() => undefined),
      new Promise<undefined>(resolve => window.setTimeout(resolve, 250)),
    ])
    const [gaClient, posthogClient] = await Promise.all([ga, posthog])
    if (!analyticsAllowed() || localStorage.getItem(revokeKey)) return undefined
    if (!gaClient && !(posthogClient && posthogClientId.test(posthogClient))) return undefined
    const stored = localStorage.getItem(measurementKey)
    const token = stored && billingMeasurementToken.test(stored) ? stored : crypto.randomUUID()
    localStorage.setItem(measurementKey, token)
    return { token, gaClient, posthogClient }
  } catch {
    return undefined
  }
}

export function consumeAnalyticsReceipts() {
  if (!analyticsConfigured) return
  const receipts = document.cookie.split('; ')
  for (const [event, name] of Object.entries(analyticsReceipts)) {
    if (!receipts.includes(name + '=1')) continue
    document.cookie = name + '=; Path=/; SameSite=Lax; Max-Age=0'
    if (event === 'signup') track('signup_completed', 'email')
    if (event === 'signupGoogle') track('signup_completed', 'google')
    if (event === 'workspace') track('workspace_created', 'cloud')
    if (event === 'page') trackMilestone('page_created')
    if (event === 'collaborators') track('paywall_hit', 'collaborators')
  }
}

function context(path: string) {
  return { page_location: location.origin + path, page_title: 'Lekhan', page_referrer: '' }
}

function enableUsageAnalytics() {
  const target = browser()
  const disabled = Reflect.get(target, disableKey) === true
  Reflect.set(target, disableKey, false)
  if (target.gtag) {
    if (disabled) target.gtag('consent', 'update', { analytics_storage: 'granted' })
    return target.gtag
  }
  target.dataLayer ??= []
  // Google Tag's queue expects the arguments object used by its bootstrap snippet.
  // eslint-disable-next-line prefer-rest-params
  target.gtag = function () { target.dataLayer?.push(arguments) }
  const gtag = target.gtag
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' })
  gtag('consent', 'update', { analytics_storage: 'granted' })
  gtag('js', new Date())
  gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, ...context('/') })

  const script = document.createElement('script')
  script.async = true
  script.referrerPolicy = 'no-referrer'
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id)
  document.head.append(script)
  return gtag
}

export function disableUsageAnalytics() {
  lastMarketingPath = null
  if (productAnalytics) void productAnalytics.then(sdk => {
    if (!analyticsAllowed()) sdk.revokeProductAnalytics()
  }).catch(() => undefined)
  if (!ga4Configured) return
  const target = browser()
  if (Reflect.get(target, disableKey)) return
  Reflect.set(target, disableKey, true)
  target.gtag?.('consent', 'update', { analytics_storage: 'denied' })
}

function countBucket(count: number) {
  if (count === 0) return '0'
  if (count === 1) return '1'
  if (count <= 10) return '2-10'
  if (count <= 50) return '11-50'
  if (count <= 100) return '51-100'
  return '101+'
}

export function track(...event: Event) {
  if (!analyticsAllowed()) return false
  const [name, detail, count, currency] = event
  let path = '/workspace'
  let properties = {}
  switch (name) {
    case 'early_access_signup':
      path = '/early'
      break
    case 'signup_started':
    case 'signup_completed':
      path = '/signup'
      properties = { method: detail }
      break
    case 'workspace_created':
      properties = { kind: detail }
      break
    case 'page_created':
    case 'link_created':
      properties = { is_first: detail }
      break
    case 'import_completed':
      properties = { source: detail, pages_bucket: countBucket(count) }
      break
    case 'import_report_viewed':
      properties = { source: detail, degraded_blocks_bucket: countBucket(count) }
      break
    case 'export_triggered':
      properties = { format: detail }
      break
    case 'ai_provider_connected':
      properties = { kind: detail }
      break
    case 'paywall_hit':
      properties = { gate: detail }
      break
    case 'upgrade_clicked':
    case 'checkout_started':
      path = '/billing'
      properties = { tier: detail, cycle: count, currency }
      break
  }
  const payload = { ...context(path), ...properties }
  if (posthogConfigured) {
    productAnalytics ??= loadProductAnalytics()
    void productAnalytics.then(sdk => sdk.captureProductEvent(name, payload, analyticsAllowed, latestTierFlags))
      .catch(() => undefined)
  }
  if (!ga4Configured) return posthogConfigured
  try {
    enableUsageAnalytics()('event', name, payload)
    return true
  } catch {
    return posthogConfigured
  }
}

const marketingRoutes = new Set<string>([...marketingPaths, '/early'])

export function trackMarketingPage(path: string) {
  if (!ga4Configured || !analyticsAllowed() || lastMarketingPath === path) return
  lastMarketingPath = path
  const route = localizedMarketingRoute(path)?.path ?? path
  if (!marketingRoutes.has(route)) return
  try { enableUsageAnalytics()('event', 'page_view', context(route)) } catch { return }
}

export function trackDailyEdit() {
  if (!analyticsAllowed()) return
  const key = analyticsPreference + ':last-edit-day'
  const day = new Date().toISOString().slice(0, 10)
  try {
    if (localStorage.getItem(key) === day) return
    if (track('daily_active_edit')) localStorage.setItem(key, day)
  } catch {
    // Storage restrictions also prevent recording the opt-in.
  }
}

export function trackMilestone(event: 'page_created' | 'link_created') {
  if (!analyticsAllowed()) return
  const key = analyticsPreference + ':' + event
  try {
    const first = localStorage.getItem(key) !== '1'
    if (track(event, first) && first) localStorage.setItem(key, '1')
  } catch {
    // The milestone flag stays on this device.
  }
}

export function trackWritingEdit(previous: string, next: string) {
  if (previous === next || !analyticsAllowed()) return
  trackDailyEdit()
  if (next.includes('[[') && wikiLinks(next).length > wikiLinks(previous).length) {
    trackMilestone('link_created')
  }
}

export function readTierGates(scope = 'personal'): TierGateFlagMap {
  return readTierGateBootstrap(scope)
}

export function bootstrapTierGates(scope = 'personal', plan?: TierGatePlanInput | null): TierGateFlagMap {
  const flags = writeTierGateBootstrap(scope, deriveTierGateFlags(plan))
  latestTierFlags = flags
  if (posthogConfigured && analyticsAllowed()) {
    productAnalytics ??= loadProductAnalytics()
    void productAnalytics.then(sdk => sdk.syncTierGateBootstrap(flags, analyticsAllowed)).catch(() => undefined)
  }
  return flags
}

export function refreshOnlineTierGates() {
  if (!posthogConfigured || !analyticsAllowed()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  productAnalytics ??= loadProductAnalytics()
  void productAnalytics.then(sdk => {
    if (latestTierFlags) sdk.syncTierGateBootstrap(latestTierFlags, analyticsAllowed)
    sdk.refreshTierGateFlags(analyticsAllowed)
  }).catch(() => undefined)
}
