import {
  captureCheckIn, captureException, flush, getClient, init,
  onUnhandledRejectionIntegration, onUncaughtExceptionIntegration,
} from '@sentry/node'
import { errorSampleRate, scrubError, sentryDsn, type RelayFailure } from './events.ts'

export function initServerObservability(service: 'app' | 'relay') {
  const dsn = sentryDsn(service === 'app' ? process.env.SENTRY_APP_DSN : process.env.SENTRY_RELAY_DSN)
  if (!dsn || getClient()) return
  try {
    init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT === 'production' ? 'production' : 'staging',
      release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
      sampleRate: errorSampleRate(process.env.SENTRY_ERROR_SAMPLE_RATE),
      defaultIntegrations: false,
      integrations: service === 'relay' ? [onUncaughtExceptionIntegration(), onUnhandledRejectionIntegration({ mode: 'strict' })] : [],
      enableOpenTelemetrySetup: false,
      enableRuntimeChannelInjection: false,
      sendClientReports: false,
      maxBreadcrumbs: 0,
      normalizeDepth: 0,
      beforeSend: event => scrubError(event, service),
    })
  } catch { /* Telemetry configuration must never interrupt the app or relay. */ }
}

export function reportException(error: unknown, operation?: RelayFailure) {
  try {
    if (getClient()) captureException(error, { tags: operation ? { operation } : {} })
  } catch { /* A reporting failure cannot replace the original error. */ }
}

export async function flushObservability() {
  if (getClient()) await flush(800).catch(() => false)
}

export async function observeRetention(run: () => Promise<Response>) {
  const monitorSlug = process.env.SENTRY_RETENTION_MONITOR_SLUG
  if (!monitorSlug || !/^[a-z0-9_-]{1,90}$/.test(monitorSlug) || !getClient()) return run()

  let checkInId: string
  try {
    checkInId = captureCheckIn({ monitorSlug, status: 'in_progress' })
  } catch {
    return run()
  }
  const started = performance.now()
  let status: 'ok' | 'error' = 'error'
  try {
    const response = await run()
    if (response.ok) status = 'ok'
    return response
  } finally {
    try {
      captureCheckIn({ checkInId, monitorSlug, status, duration: (performance.now() - started) / 1000 })
      await flushObservability()
    } catch { /* Delivering the check-in is independent of the retention result. */ }
  }
}
