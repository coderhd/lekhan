import { getPlanLimits, type PlanLimits, type PlanTier } from './tier-limits'

const storagePrefix = 'lekhan:tier-gates:'
const validTiers = new Set<PlanTier>(['free', 'plus', 'pro', 'team'])
const positiveInteger = /^[1-9]\d{0,6}$/

export interface TierGatePlanInput {
  tier: PlanTier
  seats?: number | null
  relayReadOnly?: boolean
}

export type TierGateFlagMap = {
  'tier-gate-tier': PlanTier
  'tier-gate-cloud-sync': boolean
  'tier-gate-auto-mirror': boolean
  'tier-gate-history-days': string
  'tier-gate-collaborator-cap': string
  'tier-gate-storage-mb': string
}

export function deriveTierGateFlags(plan?: TierGatePlanInput | null): TierGateFlagMap {
  const tier: PlanTier = plan && validTiers.has(plan.tier) ? plan.tier : 'free'
  const limits = getPlanLimits(tier, plan?.seats)
  const cloudSync = !(plan?.relayReadOnly ?? false)
  return {
    'tier-gate-tier': tier,
    'tier-gate-cloud-sync': cloudSync,
    'tier-gate-auto-mirror': tier !== 'free' && cloudSync,
    'tier-gate-history-days': String(limits.historyRetentionDays),
    'tier-gate-collaborator-cap': String(limits.maxDistinctCollaborators),
    'tier-gate-storage-mb': String(limits.maxStorageMb),
  }
}

export function tierGateStorageKey(scope = 'personal') {
  const normalized = scope.trim()
  return storagePrefix + (normalized || 'personal')
}

export function parseTierGateFlags(raw: string | null): TierGateFlagMap | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const tier = parsed['tier-gate-tier']
    const cloudSync = parsed['tier-gate-cloud-sync']
    const autoMirror = parsed['tier-gate-auto-mirror']
    const historyDays = parsed['tier-gate-history-days']
    const collaboratorCap = parsed['tier-gate-collaborator-cap']
    const storageMb = parsed['tier-gate-storage-mb']
    if (typeof tier !== 'string' || !validTiers.has(tier as PlanTier)) return null
    if (typeof cloudSync !== 'boolean' || typeof autoMirror !== 'boolean') return null
    if (
      typeof historyDays !== 'string' || !positiveInteger.test(historyDays) ||
      typeof collaboratorCap !== 'string' || !positiveInteger.test(collaboratorCap) ||
      typeof storageMb !== 'string' || !positiveInteger.test(storageMb)
    ) return null
    return {
      'tier-gate-tier': tier as PlanTier,
      'tier-gate-cloud-sync': cloudSync,
      'tier-gate-auto-mirror': autoMirror,
      'tier-gate-history-days': historyDays,
      'tier-gate-collaborator-cap': collaboratorCap,
      'tier-gate-storage-mb': storageMb,
    }
  } catch {
    return null
  }
}

export function readTierGateBootstrap(scope = 'personal'): TierGateFlagMap {
  try {
    if (typeof localStorage === 'undefined') return deriveTierGateFlags(null)
    return parseTierGateFlags(localStorage.getItem(tierGateStorageKey(scope))) ?? deriveTierGateFlags(null)
  } catch {
    return deriveTierGateFlags(null)
  }
}

export function writeTierGateBootstrap(scope = 'personal', flags: TierGateFlagMap): TierGateFlagMap {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(tierGateStorageKey(scope), JSON.stringify(flags))
    }
  } catch {
    // Offline flag caching is optional when browser storage is restricted.
  }
  return flags
}

export function tierSummaryFromFlags(flags: TierGateFlagMap): PlanLimits & {
  tier: PlanTier
  cloudSyncEnabled: boolean
  automaticMirrorEnabled: boolean
} {
  return {
    tier: flags['tier-gate-tier'],
    historyRetentionDays: Number(flags['tier-gate-history-days']),
    maxDistinctCollaborators: Number(flags['tier-gate-collaborator-cap']),
    maxStorageMb: Number(flags['tier-gate-storage-mb']),
    cloudSyncEnabled: flags['tier-gate-cloud-sync'],
    automaticMirrorEnabled: flags['tier-gate-auto-mirror'],
  }
}
