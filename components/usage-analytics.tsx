'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from '@/lib/i18n/client'
import {
  analyticsAllowed, analyticsConsentState, consumeAnalyticsReceipts, disableUsageAnalytics,
  refreshOnlineTierGates, setAnalyticsConsent, syncAnalyticsConsent, trackMarketingPage,
} from '@/lib/analytics'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { analyticsPreference } from '@/lib/analytics-settings'

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

export function useAnalyticsConsentChoice() {
  return useSyncExternalStore<'granted' | 'denied' | null>(subscribe, analyticsConsentState, () => 'denied')
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

export function UsageAnalyticsControl() {
  const t = useTranslations('early-access')
  const choice = useAnalyticsConsentChoice()
  return (
    <CheckboxInput
      label={t('analytics')}
      value={choice === 'granted'}
      onChange={checked => {
        setAnalyticsConsent(checked)
      }}
      size="sm"
    />
  )
}
