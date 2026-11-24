import { analyticsPreference } from './lib/analytics-settings'
import { errorSampleRate, monitoredPath, scrubError, sentryDsn } from './lib/observability/events'

const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_APP_DSN)

if (dsn) {
  void import('@sentry/browser').then(({ init, globalHandlersIntegration }) => {
    init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT === 'production' ? 'production' : 'staging',
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      sampleRate: errorSampleRate(process.env.NEXT_PUBLIC_SENTRY_ERROR_SAMPLE_RATE),
      defaultIntegrations: false,
      integrations: [globalHandlersIntegration()],
      transportOptions: { fetchOptions: { referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error' } },
      sendClientReports: false,
      maxBreadcrumbs: 0,
      normalizeDepth: 0,
      beforeSend(event) {
        try {
          if (localStorage.getItem(analyticsPreference) !== 'granted' || !monitoredPath(location.pathname)) return null
          return scrubError(event, 'browser')
        } catch { return null }
      },
    })
  }).catch(() => undefined)
}
