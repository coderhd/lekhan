import { relayFailures, type RelayFailure } from './events.ts'

const relayEvents = [...relayFailures, 'listening', 'checkpoints', 'import receipts', 'attachments'] as const
type RelayEvent = typeof relayEvents[number]
type Count = 'pruned' | 'failures' | 'deferred' | 'removed'

export function betterStackDestination(
  ingestUrl = process.env.BETTER_STACK_INGEST_URL,
  sourceToken = process.env.BETTER_STACK_SOURCE_TOKEN,
) {
  const token = sourceToken?.trim() ?? ''
  if (!/^[a-z0-9._-]+$/i.test(token)) return undefined
  try {
    const url = new URL((ingestUrl ?? '').trim())
    const knownHost = url.hostname === 'in.logs.betterstack.com' || url.hostname.endsWith('.betterstackdata.com')
    if (knownHost && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.hash && !url.search && url.pathname === '/') {
      return { url: url.href, token }
    }
  } catch { /* Local installations can use stdout alone. */ }
  return undefined
}

export function createRelayLogs({
  ingestUrl = process.env.BETTER_STACK_INGEST_URL,
  sourceToken = process.env.BETTER_STACK_SOURCE_TOKEN,
  send = fetch,
  write = console.log,
}: {
  ingestUrl?: string
  sourceToken?: string
  send?: typeof fetch
  write?: (line: string) => void
} = {}) {
  const destination = betterStackDestination(ingestUrl, sourceToken)

  const queue: object[] = []
  let active: Promise<void> | undefined
  function drain() {
    if (active || !destination || !queue.length) return
    active = send(destination.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + destination.token },
      body: JSON.stringify(queue.splice(0)),
      redirect: 'error',
      signal: AbortSignal.timeout(1_500),
    }).then(async response => { await response.body?.cancel() }).catch(() => undefined).finally(() => {
      active = undefined
      drain()
    })
  }

  return {
    configured: Boolean(destination),
    log(operation: RelayEvent, level: 'info' | 'error', counts: Partial<Record<Count, number>> = {}) {
      if (!relayEvents.includes(operation)) return
      const fields: Partial<Record<Count, number>> = {}
      for (const name of ['pruned', 'failures', 'deferred', 'removed'] as const) {
        const count = counts[name]
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) fields[name] = count
      }
      const event = { dt: new Date().toISOString(), service: 'relay', level, operation, ...fields }
      write(JSON.stringify(event))
      if (destination && queue.length < 32) {
        queue.push(event)
        drain()
      }
    },
    async flush() {
      while (active) await active
    },
  }
}

export function createRelayFaultReporter(log: (operation: RelayFailure, error: unknown) => void, now = Date.now) {
  const lastReported = new Map<RelayFailure, number>()
  return (operation: RelayFailure, error: unknown) => {
    const time = now()
    if (time - (lastReported.get(operation) ?? -Infinity) < 30_000) return
    lastReported.set(operation, time)
    log(operation, error)
  }
}
