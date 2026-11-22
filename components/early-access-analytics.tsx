'use client'

import { useSyncExternalStore, useEffect } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import { disableUsageAnalytics, enableUsageAnalytics, track } from '@/lib/analytics'

const key = 'lekhan:usage-analytics'

function subscribe(check: () => void) {
  window.addEventListener('storage', check)
  window.addEventListener(key, check)
  return () => { window.removeEventListener('storage', check); window.removeEventListener(key, check) }
}

function allowed() {
  try { return localStorage.getItem(key) === 'granted' } catch { return false }
}

export default function EarlyAccessAnalytics({ id, signup }: { id: string; signup: string | null }) {
  const t = useTranslations('early-access')
  const consent = useSyncExternalStore(subscribe, allowed, () => false)

  useEffect(() => {
    if (!consent) return disableUsageAnalytics()
    enableUsageAnalytics(id)
    if (!signup) return
    try {
      const event = key + ':' + signup
      if (sessionStorage.getItem(event)) return
      sessionStorage.setItem(event, '1')
    } catch { return }
    track('early_access_signup')
  }, [consent, id, signup])

  return <label className="early-analytics">
    <input type="checkbox" checked={consent} onChange={event => {
      try { localStorage.setItem(key, event.target.checked ? 'granted' : 'denied') } catch { return }
      window.dispatchEvent(new Event(key))
    }} /> {t('analytics')}
  </label>
}
