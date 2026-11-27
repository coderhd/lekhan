import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as healthGet, HEAD as healthHead } from '../../app/api/health/route'
import { monitoredPath, scrubError, sentryDsn } from '../../lib/observability/events'
import { betterStackDestination, createRelayFaultReporter, createRelayLogs } from '../../lib/observability/relay-logs'
import { observeRetention } from '../../lib/observability/sentry-node'

const sentry = vi.hoisted(() => ({
  captureCheckIn: vi.fn(() => 'retention-check-in'),
  getClient: vi.fn(() => ({})),
  flush: vi.fn(async () => true),
}))
vi.mock('@sentry/node', () => sentry)

describe('error-data handling', () => {
  it('allows the Next.js request hook to skip private document routes', () => {
    for (const path of ['/doc', '/doc/a?title=secret', '/page/private/share', '//page/private', '/%64oc/a', '/%zz']) {
      expect(monitoredPath(path)).toBe(false)
    expect(monitoredPath('/cloud-offline?page=private-id')).toBe(false)
    expect(monitoredPath('/workspace-offline')).toBe(false)
    }
    for (const path of ['/', '/workspace', '/api/cron/retention-prune']) expect(monitoredPath(path)).toBe(true)
  })

  it('rebuilds an error event from a fixed schema and keeps public code locations', () => {
    const privateValue = 'private-note-title-user-data'
    const event = scrubError({
      type: undefined,
      user: { id: privateValue, email: privateValue },
      request: { url: 'https://lekhan.app/doc/' + privateValue, data: privateValue, headers: { Authorization: privateValue } },
      breadcrumbs: [{ category: 'console', message: privateValue }],
      extra: { prompt: privateValue },
      message: privateValue,
      release: 'a1b2c3d4',
      tags: { operation: 'persist', title: privateValue },
      exception: { values: [{ type: privateValue, value: privateValue, stacktrace: { frames: [
        { filename: 'https://lekhan.app/doc/' + privateValue },
        { filename: 'file:///build/server/sync/hub.ts?title=' + privateValue, function: privateValue, lineno: 163, vars: { title: privateValue } },
      ] } }] },
    }, 'relay')
    expect(JSON.stringify(event)).not.toContain(privateValue)
    expect(event.tags).toEqual({ service: 'relay', operation: 'persist' })
    expect(event.release).toBe('a1b2c3d4')
    expect(event.exception?.values?.[0]).toMatchObject({
      type: 'Error', value: 'relay error', stacktrace: { frames: [{ filename: '/server/sync/hub.ts', lineno: 163 }] },
    })
  })

  it('requires a valid HTTPS Sentry DSN', () => {
    expect(sentryDsn('https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42')).toBeDefined()
    expect(sentryDsn('https://not-a-key@o1.ingest.sentry.io/42')).toBeUndefined()
    expect(sentryDsn('http://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42')).toBeUndefined()
  })
})

describe('sync relay logs', () => {
  it('sends only fixed log fields and numeric counters', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    const write = vi.fn()
    const url = 'https://fixture.betterstackdata.com/'
    const logs = createRelayLogs({ ingestUrl: url, sourceToken: 'fixture-only', send, write })
    const counts = { pruned: 5, failures: -1, note: 'private body' }
    logs.log('checkpoints', 'info', counts)
    await logs.flush()
    expect(send).toHaveBeenCalledOnce()
    const [destination, request] = send.mock.calls[0]
    expect(destination).toBe(url)
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer fixture-only' })
    const [record] = JSON.parse(String(request?.body))
    expect(record).toEqual({ dt: expect.any(String), service: 'relay', level: 'info', operation: 'checkpoints', pruned: 5 })
    expect(JSON.parse(write.mock.calls[0][0])).toEqual(record)
  })

  it('uses stdout alone for an invalid log destination, and throttles repeats per failed operation', async () => {
    const send = vi.fn<typeof fetch>()
    const write = vi.fn()
    const logs = createRelayLogs({ ingestUrl: 'https://betterstackdata.com.other.example', sourceToken: 'fixture-only', send, write })
    const now = vi.fn().mockReturnValue(0)
    const report = createRelayFaultReporter(operation => logs.log(operation, 'error'), now)
    report('persist', new Error('private'))
    report('persist', new Error('private'))
    report('open', new Error('private'))
    now.mockReturnValue(30_000)
    report('persist', new Error('private'))
    await logs.flush()
    expect(send).not.toHaveBeenCalled()
    expect(logs.configured).toBe(false)
    expect(write).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(write.mock.calls)).not.toContain('private')
  })

  it('validates Better Stack ingest origins and keeps server telemetry tokens out of client files', () => {
    expect(betterStackDestination('https://in.logs.betterstack.com', 'tok_123')).toEqual({
      url: 'https://in.logs.betterstack.com/',
      token: 'tok_123',
    })
    expect(betterStackDestination('https://s12345.eu-nbg-2.betterstackdata.com/', 'tok.abc_9')).toEqual({
      url: 'https://s12345.eu-nbg-2.betterstackdata.com/',
      token: 'tok.abc_9',
    })
    expect(betterStackDestination('http://in.logs.betterstack.com', 'tok_123')).toBeUndefined()
    expect(betterStackDestination('https://in.logs.betterstack.com/custom', 'tok_123')).toBeUndefined()
    expect(betterStackDestination('https://in.logs.betterstack.com?q=1', 'tok_123')).toBeUndefined()
    expect(betterStackDestination('https://in.logs.betterstack.com', 'bad token\n')).toBeUndefined()

    const root = process.cwd()
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const target = join(dir, entry.name)
      return entry.isDirectory() ? walk(target) : /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [target] : []
    })
    const serverSecrets = ['BETTER_STACK_SOURCE_TOKEN', 'BETTER_STACK_INGEST_URL', 'SENTRY_APP_DSN', 'SENTRY_RELAY_DSN', 'GA4_MEASUREMENT_API_SECRET']
    const clientCandidates = [...walk(join(root, 'components')), ...walk(join(root, 'public')), ...walk(join(root, 'lib'))]
      .filter(file => {
        const text = readFileSync(file, 'utf8')
        return file.startsWith(join(root, 'components')) || file.startsWith(join(root, 'public')) || /^['"]use client['"]/.test(text.trimStart())
      })
    for (const file of clientCandidates) {
      const content = readFileSync(file, 'utf8')
      for (const secret of serverSecrets) expect(content).not.toContain(secret)
    }
  })

  it('serves a lightweight non-cached health endpoint for Better Stack app monitors', async () => {
    const getResponse = await healthGet()
    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(await getResponse.json()).toEqual({ ok: true, service: 'app' })

    const headResponse = await healthHead()
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('retention job check-ins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SENTRY_RETENTION_MONITOR_SLUG', 'retention-prune')
    return () => vi.unstubAllEnvs()
  })

  it.each([[200, 'ok'], [503, 'error']] as const)('reports HTTP %d as %s', async (status, terminal) => {
    const response = await observeRetention(async () => new Response(null, { status }))
    expect(response.status).toBe(status)
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(1, { status: 'in_progress', monitorSlug: 'retention-prune' })
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      status: terminal, monitorSlug: 'retention-prune', checkInId: 'retention-check-in', duration: expect.any(Number),
    })
    expect(sentry.flush).toHaveBeenCalledWith(800)
  })

  it('reports a thrown job failure and preserves the original exception', async () => {
    const error = new Error('job failed')
    await expect(observeRetention(async () => { throw error })).rejects.toBe(error)
    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }))
  })
})
