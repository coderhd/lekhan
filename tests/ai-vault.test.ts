import { describe, expect, it } from 'vitest'
import type { ProviderConfig } from '../lib/ai/provider-registry'
import { createProviderVault, unlockProviderVault } from '../lib/ai/vault'

const passphrase = 'this is a private passphrase'
const configs: ProviderConfig[] = [
  { id: 'personal', provider: 'openai', model: 'some-model', apiKey: 'private-api-key' },
  { id: 'local', provider: 'ollama', model: 'local-model' },
]

describe('provider vault', () => {
  it('seals multiple configs with randomized authenticated encryption and explicitly unlocks them', async () => {
    const vault = await createProviderVault(passphrase, configs)
    const envelope = await vault.seal()
    expect(envelope).not.toContain('private-api-key')
    expect(envelope).not.toContain(passphrase)
    expect(await vault.seal()).not.toEqual(envelope)
    const reopened = await unlockProviderVault(passphrase, envelope)
    expect(reopened.configs).toEqual(configs)
    const changed = await reopened.seal(configs.slice(1))
    expect((await unlockProviderVault(passphrase, changed)).configs).toEqual(configs.slice(1))
  })

  it('rejects a wrong passphrase and altered ciphertext', async () => {
    const vault = await createProviderVault(passphrase, configs)
    const envelope = await vault.seal()
    await expect(unlockProviderVault('a different passphrase', envelope)).rejects.toThrow(/unlock/i)
    const parts = envelope.split('.')
    parts[parts.length - 1] = (parts.at(-1)?.startsWith('a') ? 'b' : 'a') + parts.at(-1)?.slice(1)
    await expect(unlockProviderVault(passphrase, parts.join('.'))).rejects.toThrow(/unlock/i)
  })
})
