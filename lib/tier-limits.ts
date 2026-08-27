export type PlanTier = 'free' | 'plus' | 'pro'

export interface PlanLimits {
	historyRetentionDays: number
	maxDistinctCollaborators: number
	maxStorageMb: number
}

const FREE_LIMITS: PlanLimits = {
	historyRetentionDays: 1,
	maxDistinctCollaborators: 2,
	maxStorageMb: 1000
}

const PLUS_LIMITS: PlanLimits = {
	historyRetentionDays: 90,
	maxDistinctCollaborators: 10,
	maxStorageMb: 10000
}

const PRO_LIMITS: PlanLimits = {
	historyRetentionDays: 365,
	maxDistinctCollaborators: 100,
	maxStorageMb: 50000
}

export function getPlanLimits(plan?: string | null): PlanLimits {
	if (plan === 'plus') return PLUS_LIMITS
	if (plan === 'pro') return PRO_LIMITS
	return FREE_LIMITS
}

export function getExpirationCutoffDate(plan?: string | null, referenceNow?: Date): Date {
	const limits = getPlanLimits(plan)
	const now = referenceNow || new Date()
	const cutoff = new Date(now.getTime())
	cutoff.setDate(cutoff.getDate() - limits.historyRetentionDays)
	return cutoff
}

export function isExpiredVersion(plan: string | null | undefined, versionCreatedAt: string | Date, referenceNow?: Date): boolean {
	const cutoff = getExpirationCutoffDate(plan, referenceNow)
	const createdAt = new Date(versionCreatedAt)
	return createdAt < cutoff
}
