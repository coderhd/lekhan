'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'
import { analyticsPreference } from '@/lib/analytics-settings'
import { UsageAnalyticsControl, useAnalyticsConsent } from './usage-analytics'

export default function EarlyAccessAnalytics({ signup }: { signup: string | null }) {
  const consent = useAnalyticsConsent()

  useEffect(() => {
    if (!consent || !signup) return
    try {
      const event = analyticsPreference + ':' + signup
      if (!sessionStorage.getItem(event) && track('early_access_signup')) sessionStorage.setItem(event, '1')
    } catch { return }
  }, [consent, signup])

  return <UsageAnalyticsControl early />
}
