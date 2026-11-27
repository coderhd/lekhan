import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveTierGateFlags,
  parseTierGateFlags,
  readTierGateBootstrap,
  tierGateStorageKey,
  writeTierGateBootstrap,
} from '../../lib/tier-gate-flags'

function createStorage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
    clear: () => { entries.clear() },
    entries,
  }
}

describe('tier-gate PostHog bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('derives billing-aligned flags for every tier and read-only grace expiry', () => {
    expect(deriveTierGateFlags(null)).toEqual({
      'tier-gate-tier': 'free',
      'tier-gate-cloud-sync': true,
      'tier-gate-auto-mirror': false,
      'tier-gate-history-days': '1',
      'tier-gate-collaborator-cap': '2',
    })

    expect(deriveTierGateFlags({ tier: 'plus' })).toEqual({
      'tier-gate-tier': 'plus',
      'tier-gate-cloud-sync': true,
      'tier-gate-auto-mirror': true,
      'tier-gate-history-days': '90',
      'tier-gate-collaborator-cap': '10',
    })

    expect(deriveTierGateFlags({ tier: 'team', seats: 12, relayReadOnly: true })).toEqual({
      'tier-gate-tier': 'team',
      'tier-gate-cloud-sync': false,
      'tier-gate-auto-mirror': false,
      'tier-gate-history-days': '365',
      'tier-gate-collaborator-cap': '12',
    })
  })

  it('persists scoped flags locally for offline boot without PII and falls back cleanly on invalid storage', () => {
    const storage = createStorage()
    vi.stubGlobal('localStorage', storage)

    const flags = deriveTierGateFlags({ tier: 'pro' })
    writeTierGateBootstrap('account:subject-a', flags)

    const stored = storage.getItem(tierGateStorageKey('account:subject-a'))
    expect(stored).not.toBeNull()
    expect(stored).not.toMatch(/email|title|workspace_id|token/)
    expect(readTierGateBootstrap('account:subject-a')).toEqual(flags)

    storage.setItem(tierGateStorageKey('account:subject-a'), JSON.stringify({ 'tier-gate-tier': 'enterprise' }))
    expect(readTierGateBootstrap('account:subject-a')).toEqual(deriveTierGateFlags(null))
    expect(parseTierGateFlags('not-json')).toBeNull()
  })

  it('writes offline bootstrap without loading or calling PostHog when analytics consent is not granted', async () => {
    const storage = createStorage()
    const fetchSpy = vi.fn()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_LekhanFixture')
    vi.resetModules()

    const { bootstrapTierGates } = await import('../../lib/analytics')
    const written = bootstrapTierGates('account:offline-user', { tier: 'plus' })

    expect(written['tier-gate-tier']).toBe('plus')
    expect(bootstrapTierGates('account:offline-user')).toEqual(written)
    expect(bootstrapTierGates('account:another-user')).toEqual(deriveTierGateFlags(null))
    expect(bootstrapTierGates('account:offline-user')).toEqual(written)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
