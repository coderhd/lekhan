export const analyticsPreference = 'lekhan:usage-analytics'
export const analyticsConsentCookie = 'lekhan_usage_analytics'
export const billingMeasurementToken = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const googleClientId = /^[0-9]{1,20}\.[0-9]{1,20}$/
export const posthogClientId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
export const analyticsReceipts = {
  signup: 'lekhan_analytics_signup',
  signupGoogle: 'lekhan_analytics_signup_google',
  workspace: 'lekhan_analytics_workspace',
  page: 'lekhan_analytics_page',
  collaborators: 'lekhan_analytics_collaborators',
} as const

const posthogHosts = new Set(['https://eu.i.posthog.com', 'https://us.i.posthog.com'])

export function resolvePostHogHost(value?: string) {
  const normalized = value?.trim().replace(/\/+$/, '')
  return normalized && posthogHosts.has(normalized) ? normalized : 'https://eu.i.posthog.com'
}

export const analyticsId = process.env.NEXT_PUBLIC_GA4_ID?.trim() ?? ''
export const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? ''
export const posthogHost = resolvePostHogHost(process.env.NEXT_PUBLIC_POSTHOG_HOST)
export const ga4Configured = /^G-[A-Z0-9]+$/.test(analyticsId)
export const posthogConfigured = /^phc_[a-z0-9]+$/i.test(posthogToken)
export const analyticsConfigured = ga4Configured || posthogConfigured
