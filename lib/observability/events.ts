import type { ErrorEvent, StackFrame } from '@sentry/browser'

export const relayFailures = ['persist', 'receive', 'cloud transfer', 'open', 'retention', 'waitlist', 'shutdown'] as const
export type RelayFailure = typeof relayFailures[number]
export type ErrorService = 'browser' | 'app' | 'relay'

const errorTypes = new Set(['Error', 'AggregateError', 'ReferenceError', 'TypeError', 'RangeError', 'SyntaxError', 'URIError'])
const publicCode = /(?:^|\/)((?:_next\/static\/chunks|\.next\/server)\/[\w./~%-]+\.(?:js|mjs)|server\/sync\/[\w/-]+\.ts)$/
const releaseId = /^[a-f0-9]{7,64}$/i

export function errorSampleRate(value?: string) {
  const rate = value?.trim() ? Number(value) : NaN
  return rate >= 0 && rate <= 1 ? rate : 1
}

export function monitoredPath(path: string) {
  try {
    const route = decodeURIComponent(path.split(/[?#]/, 1)[0]).replace(/\/{2,}/g, '/')
    return route.startsWith('/') && !/^\/(?:doc|page|cloud-offline)(?:\/|$)/i.test(route)
  } catch { return false }
}

export function sentryDsn(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && /^[a-f\d]{32}$/i.test(url.username) && !url.password &&
      !url.search && !url.hash && /\/\d+$/.test(url.pathname)) return url.href
  } catch { /* Invalid telemetry configuration leaves reporting disabled. */ }
  return undefined
}

function publicFrame(frame: StackFrame): StackFrame | undefined {
  const path = frame.filename?.split(/[?#]/, 1)[0].replace(/\\/g, '/')
  const name = path?.match(publicCode)?.[1]
  if (!name || name.split('/').some(part => part === '..')) return undefined
  return {
    filename: '/' + name,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: true,
  }
}

export function scrubError(event: ErrorEvent, service: ErrorService): ErrorEvent {
  const operation = relayFailures.find(value => value === event.tags?.operation)
  const exception = event.exception?.values?.at(-1)
  const frames = (exception?.stacktrace?.frames ?? []).flatMap(frame => publicFrame(frame) ?? []).slice(-24)
  const type = exception?.type && errorTypes.has(exception.type) ? exception.type : 'Error'
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    release: event.release && releaseId.test(event.release) ? event.release : undefined,
    environment: event.environment === 'production' ? 'production' : 'staging',
    tags: { service, ...(service === 'relay' && operation ? { operation } : {}) },
    exception: { values: [{ type, value: service + ' error', ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    ...(service === 'relay' && operation ? { fingerprint: [service, operation, '{{ default }}'] } : {}),
  }
}
