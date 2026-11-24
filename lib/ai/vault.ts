import { strFromU8 } from 'fflate'
import { MAX_FALLBACK_MODELS, providerDefinition, type ProviderConfig } from './provider-registry'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const context = encoder.encode('Lekhan provider vault v1')
const iterations = 600_000

const encode = (bytes: Uint8Array) => btoa(strFromU8(bytes, true))
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

function validateConfigs(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid provider configurations.')
  const ids = new Set<string>()
  return value.map(config => {
    if (!config || typeof config !== 'object' ||
      typeof config.id !== 'string' || typeof config.model !== 'string' || typeof config.provider !== 'string' ||
      ids.has(config.id) ||
      ['label', 'baseUrl', 'apiKey'].some(key => config[key] !== undefined && typeof config[key] !== 'string')) {
      throw new Error('Invalid provider configuration.')
    }
    providerDefinition(config.provider)
    const fallback: unknown = config.fallback
    if (fallback !== undefined && (!Array.isArray(fallback) || fallback.length > MAX_FALLBACK_MODELS ||
      fallback.some(id => typeof id !== 'string' || id.length > 270 || !/^(provider|device):.+$/.test(id)) ||
      new Set(fallback).size !== fallback.length)) throw new Error('Invalid model fallback chain.')
    ids.add(config.id)
    const { id, provider, model, label, baseUrl, apiKey } = config
    return { id, provider, model, label, baseUrl, apiKey, ...(fallback === undefined ? {} : { fallback: fallback as string[] }) }
  })
}

function session(key: CryptoKey, salt: Uint8Array<ArrayBuffer>, configs: ProviderConfig[]) {
  return {
    configs,
    async seal(next: ProviderConfig[] = configs) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const clear = encoder.encode(JSON.stringify(validateConfigs(next)))
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context }, key, clear)
      return ['v1', encode(salt), encode(iv), encode(new Uint8Array(data))].join('.')
    },
  }
}

export async function createProviderVault(passphrase: string, configs: ProviderConfig[] = []) {
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return session(await derive(passphrase, salt), salt, validateConfigs(configs))
}

export async function unlockProviderVault(passphrase: string, envelope: string) {
  try {
    if (envelope.length > 1_000_000) throw new Error('Vault exceeds limit')
    const [version, encodedSalt, encodedIv, encodedData, extra] = envelope.split('.')
    if (version !== 'v1' || extra !== undefined) throw new Error('Invalid envelope')
    const salt = decode(encodedSalt)
    const iv = decode(encodedIv)
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid envelope')
    const key = await derive(passphrase, salt)
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context }, key, decode(encodedData))
    return session(key, salt, validateConfigs(JSON.parse(decoder.decode(clear))))
  } catch {
    throw new Error('Could not unlock the provider vault. Check your passphrase or vault file.')
  }
}
