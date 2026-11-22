'use client'

type Key = 'early_access_signup'
type GoogleTag = (...args: unknown[]) => void

function browser() {
  return window as Window & { dataLayer?: unknown[]; gtag?: GoogleTag }
}

export function enableUsageAnalytics(id: string) {
  if (!/^G-[A-Z0-9]+$/.test(id)) return
  const target = browser()
  if (target.gtag) {
    target.gtag('consent', 'update', { analytics_storage: 'granted' })
    return
  }
  target.dataLayer ??= []
  // Google Tag's queue expects the arguments object used by its bootstrap snippet.
  // eslint-disable-next-line prefer-rest-params
  target.gtag = function () { target.dataLayer?.push(arguments) }
  const gtag = target.gtag
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' })
  gtag('consent', 'update', { analytics_storage: 'granted' })
  gtag('js', new Date())
  gtag('config', id, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    page_location: location.origin + '/early', page_title: 'Lekhan early access', page_referrer: '' })

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id)
  document.head.append(script)
}

export function disableUsageAnalytics() {
  browser().gtag?.('consent', 'update', { analytics_storage: 'denied' })
}

export function track(event: Key) {
  browser().gtag?.('event', event, { page_location: location.origin + '/early', page_title: 'Lekhan early access', page_referrer: '' })
}
