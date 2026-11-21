export type PlanTier = 'free' | 'plus' | 'pro' | 'team'

export interface PlanLimits {
	historyRetentionDays: number
	maxDistinctCollaborators: number
	maxStorageMb: number
}

const FREE_LIMITS: PlanLimits = {
	historyRetentionDays: 1,
	maxDistinctCollaborators: 2,
	maxStorageMb: 20
}

const PLUS_LIMITS: PlanLimits = {
	historyRetentionDays: 90,
	maxDistinctCollaborators: 10,
	maxStorageMb: 10000
}

const PRO_LIMITS: PlanLimits = {
	historyRetentionDays: 365,
	maxDistinctCollaborators: 25,
	maxStorageMb: 50000
}

// PDEC-9 (TL-ruled): Team rides the Pro retention/storage envelope; the
// collaborator cap is derived from the purchased seats (owner excluded).
const TEAM_LIMITS: Omit<PlanLimits, 'maxDistinctCollaborators'> = {
	historyRetentionDays: 365,
	maxStorageMb: 50000
}

const TEAM_MIN_SEATS = 2

export function getPlanLimits(plan?: string | null, seats?: number | null): PlanLimits {
	if (plan === 'plus') return PLUS_LIMITS
	if (plan === 'pro') return PRO_LIMITS
	if (plan === 'team') {
		if (typeof seats !== 'number' || !Number.isFinite(seats) || seats < TEAM_MIN_SEATS) {
			console.warn(`[tier-limits] Team plan requires at least ${TEAM_MIN_SEATS} seats; received ${String(seats)}. Falling back to the ${TEAM_MIN_SEATS}-seat floor.`)
			return { ...TEAM_LIMITS, maxDistinctCollaborators: TEAM_MIN_SEATS }
		}
		return { ...TEAM_LIMITS, maxDistinctCollaborators: seats }
	}
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
