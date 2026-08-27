export type HardwareTier = 'light' | 'medium' | 'heavy'

export interface HardwareProfile {
	ramGb: number
	cpuCores: number
	hasWebGPU: boolean
	gpuVendor?: string
	gpuRenderer?: string
	tier: HardwareTier
	label: string
	recommendedMaxLocalModelSize: string
}

export async function detectHardwareProfile(): Promise<HardwareProfile> {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return {
			ramGb: 8,
			cpuCores: 4,
			hasWebGPU: false,
			tier: 'medium',
			label: 'Standard (8 GB RAM)',
			recommendedMaxLocalModelSize: '3B–8B'
		}
	}

	const ramGb = (navigator as any).deviceMemory || 8
	const cpuCores = navigator.hardwareConcurrency || 4
	
	let hasWebGPU = false
	let gpuVendor: string | undefined
	let gpuRenderer: string | undefined

	if ('gpu' in navigator && (navigator as any).gpu?.requestAdapter) {
		try {
			const adapter = await (navigator as any).gpu.requestAdapter()
			if (adapter) {
				hasWebGPU = true
				gpuVendor = adapter.vendor || (adapter as any).info?.vendor
				gpuRenderer = adapter.architecture || (adapter as any).info?.architecture || (adapter as any).info?.device
			}
		} catch {
			// WebGPU not available or permission denied
		}
	}

	let tier: HardwareTier = 'light'
	let recommendedMaxLocalModelSize = 'Cloud / 1B only'
	let label = 'Lightweight (<8 GB RAM)'

	if (ramGb >= 16) {
		tier = 'heavy'
		recommendedMaxLocalModelSize = '14B–32B'
		label = hasWebGPU 
			? `Heavy Workstation (${ramGb} GB RAM, WebGPU)`
			: `Heavy Workstation (${ramGb} GB RAM)`
	} else if (ramGb >= 8) {
		tier = 'medium'
		recommendedMaxLocalModelSize = '3B–8B'
		label = `Standard (${ramGb} GB RAM)`
	}

	return {
		ramGb,
		cpuCores,
		hasWebGPU,
		gpuVendor,
		gpuRenderer,
		tier,
		label,
		recommendedMaxLocalModelSize
	}
}

export function getHardwareRecommendation(profile: HardwareProfile): { isLocalFeasible: boolean, warning?: string, badgeText: string, badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' } {
	if (profile.tier === 'light') {
		return {
			isLocalFeasible: false,
			warning: 'Running models locally may slow down your system. We recommend using free cloud models.',
			badgeText: 'Cloud Recommended',
			badgeVariant: 'secondary'
		}
	}
	
	if (profile.tier === 'medium') {
		return {
			isLocalFeasible: true,
			badgeText: 'Optimal for 3B–8B',
			badgeVariant: 'default'
		}
	}
	
	return {
		isLocalFeasible: true,
		badgeText: 'High Performance (14B+)',
		badgeVariant: 'default'
	}
}
