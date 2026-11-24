import type { Instrumentation } from 'next'
import { monitoredPath } from './lib/observability/events'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_APP_DSN) return
  const { initServerObservability } = await import('./lib/observability/sentry-node')
  initServerObservability('app')
}

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_APP_DSN || !monitoredPath(request.path)) return
  const { reportException, flushObservability } = await import('./lib/observability/sentry-node')
  reportException(error)
  await flushObservability()
}
