'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'
import {
  analyticsAllowed, consumeAnalyticsReceipts, disableUsageAnalytics,
  refreshOnlineTierGates, syncAnalyticsConsent, trackMarketingPage,
} from '@/lib/analytics'
import { analyticsConfigured, analyticsPreference } from '@/lib/analytics-settings'

function subscribe(check: () => void) {
  window.addEventListener('storage', check)
  window.addEventListener(analyticsPreference, check)
  return () => {
    window.removeEventListener('storage', check)
    window.removeEventListener(analyticsPreference, check)
  }
}

export function useAnalyticsConsent() {
  return useSyncExternalStore(subscribe, analyticsAllowed, () => false)
}

export function UsageAnalyticsObserver() {
  const consent = useAnalyticsConsent()
  const path = usePathname()
  useEffect(() => {
    const allowed = analyticsAllowed()
    if (!allowed) disableUsageAnalytics()
    syncAnalyticsConsent(allowed)
    consumeAnalyticsReceipts()
    trackMarketingPage(path)
  }, [consent, path])
  useEffect(() => {
    const sync = () => {
      const allowed = analyticsAllowed()
      syncAnalyticsConsent(allowed)
      if (allowed) refreshOnlineTierGates()
    }
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])
  return null
}

export function UsageAnalyticsReceipts() {
  useEffect(() => { consumeAnalyticsReceipts() }, [])
  return null
}

export function UsageAnalyticsControl({ early = false }: { early?: boolean }) {
  const t = useTranslations('early-access')
  const consent = useAnalyticsConsent()
  if (!analyticsConfigured) return null
  return <label className={early ? 'analytics-control early-analytics' : 'analytics-control'}>
    <input type="checkbox" checked={consent} onChange={event => {
      try {
        localStorage.setItem(analyticsPreference, event.target.checked ? 'granted' : 'denied')
      } catch { return }
      syncAnalyticsConsent(event.target.checked)
      if (!event.target.checked) disableUsageAnalytics()
      window.dispatchEvent(new Event(analyticsPreference))
    }} /> {t('analytics')}
  </label>
}
