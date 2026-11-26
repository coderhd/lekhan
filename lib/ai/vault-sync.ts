export const providerVaultLimit = 1_000_000
export const vaultRevisionPattern = /^[a-f0-9]{64}$/

export type CloudProviderVault = { envelope: string; revision: string }

export function validProviderEnvelope(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > providerVaultLimit) return false
  const parts = value.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^[A-Za-z0-9+/]{22}==$/.test(parts[1]) ||
    !/^[A-Za-z0-9+/]{16}$/.test(parts[2])) return false
  // AES-GCM ciphertext includes a tag. Even an empty registry needs at least 18 bytes.
  const cipher = parts[3]
  return cipher.length >= 24 && cipher.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(cipher)
}

export async function encryptedVaultRevision(envelope: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(envelope))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export class ProviderVaultConflict extends Error {}

async function vaultRequest(subject: string, options: RequestInit) {
  const response = await fetch('/api/ai/vault', {
    ...options, headers: { ...options.headers, 'X-Lekhan-Account': subject },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  })
  if (response.status === 409) throw new ProviderVaultConflict('The account vault changed.')
  if (!response.ok) throw new Error('The account vault is unavailable.')
  return response.json()
}

export async function readAccountVault(subject: string, signal: AbortSignal): Promise<CloudProviderVault | null> {
  const { vault } = await vaultRequest(subject, { signal })
  if (vault === null) return null
  if (!validProviderEnvelope(vault?.envelope) || typeof vault.revision !== 'string' ||
    vault.revision !== await encryptedVaultRevision(vault.envelope)) throw new Error('The account vault is unreadable.')
  return { envelope: vault.envelope, revision: vault.revision }
}

export async function writeAccountVault(subject: string, envelope: string, previous: string | null, signal: AbortSignal): Promise<string> {
  if (!validProviderEnvelope(envelope) || (previous !== null && !vaultRevisionPattern.test(previous))) {
    throw new Error('The account vault is unreadable.')
  }
  const { revision } = await vaultRequest(subject, {
    method: 'PUT', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope, previous }),
  })
  if (revision !== await encryptedVaultRevision(envelope)) throw new Error('The account vault could not be confirmed.')
  return revision
}
