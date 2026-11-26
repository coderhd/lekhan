import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderVault, unlockProviderVault } from '../../lib/ai/vault'
import { encryptedVaultRevision, readAccountVault, writeAccountVault, ProviderVaultConflict, validProviderEnvelope } from '../../lib/ai/vault-sync'

const passphrase = 'a separate vault passphrase'
const credential = 'provider-key-for-fixture'
const subject = '043be768-82ea-42fe-8489-97c50edbf9b0'

afterEach(() => vi.unstubAllGlobals())

describe('encrypted account vault transport', () => {
  it('uploads only a ciphertext envelope and restores using the original passphrase', async () => {
    const vault = await createProviderVault(passphrase, [{ id: 'openai', provider: 'openai', model: 'example-model', apiKey: credential }])
    const envelope = await vault.seal()
    const revision = await encryptedVaultRevision(envelope)
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ revision }))
      .mockResolvedValueOnce(Response.json({ vault: { revision, envelope } }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal

    await expect(writeAccountVault(subject, envelope, null, signal)).resolves.toBe(revision)
    const [url, write] = fetch.mock.calls[0]
    expect(url).toBe('/api/ai/vault')
    expect(write).toMatchObject({ method: 'PUT', cache: 'no-store', headers: { 'X-Lekhan-Account': subject } })
    expect(JSON.parse(write?.body as string)).toEqual({ envelope, previous: null })
    expect(write?.body).not.toContain(credential)
    expect(write?.body).not.toContain(passphrase)

    const saved = await readAccountVault(subject, signal)
    await expect(unlockProviderVault('an incorrect passphrase', saved!.envelope)).rejects.toThrow(/unlock/i)
    expect((await unlockProviderVault(passphrase, saved!.envelope)).configs[0].apiKey).toBe(credential)
  })

  it('reports stale writes without retrying against the newer revision', async () => {
    const vault = await createProviderVault(passphrase)
    const envelope = await vault.seal()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    await expect(writeAccountVault(subject, envelope, 'a'.repeat(64), new AbortController().signal))
      .rejects.toBeInstanceOf(ProviderVaultConflict)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects malformed envelopes and inconsistent backup revisions', async () => {
    const envelope = await (await createProviderVault(passphrase)).seal()
    expect(validProviderEnvelope(envelope)).toBe(true)
    for (const malformed of ['{}', passphrase, envelope + '.', envelope.slice(0, -1), 'a'.repeat(1_000_001)]) {
      expect(validProviderEnvelope(malformed)).toBe(false)
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ vault: { revision: 'a'.repeat(64), envelope } })))
    await expect(readAccountVault(subject, new AbortController().signal)).rejects.toThrow(/unreadable/)
  })
})
