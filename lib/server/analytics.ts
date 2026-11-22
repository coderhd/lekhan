import 'server-only'

import { cookies } from 'next/headers'
import { analyticsConfigured, analyticsConsentCookie, analyticsReceipts } from '../analytics-settings'

export async function recordAnalyticsReceipt(event: keyof typeof analyticsReceipts) {
  if (!analyticsConfigured) return
  const jar = await cookies()
  if (jar.get(analyticsConsentCookie)?.value !== 'granted') return
  jar.set(analyticsReceipts[event], '1', {
    path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60,
  })
}
