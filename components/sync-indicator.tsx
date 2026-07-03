'use client'

import { Cloud, CloudOff, CloudLightning } from 'lucide-react'

interface SyncIndicatorProps {
	isConnected: boolean
	isSynced: boolean
}

export default function SyncIndicator ({
	isConnected,
	isSynced,
}: SyncIndicatorProps) {
	if (!isConnected) {
		return (
			<div className='flex items-center gap-1.5 rounded-full bg-red-950/40 border border-red-500/20 px-3 py-1 text-xs font-semibold text-red-400 backdrop-blur-md'>
				<CloudOff className='h-3.5 w-3.5' />
				<span>Offline Mode</span>
			</div>
		)
	}

	if (!isSynced) {
		return (
			<div className='flex items-center gap-1.5 rounded-full bg-amber-950/40 border border-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-400 backdrop-blur-md'>
				<Cloud className='h-3.5 w-3.5 animate-pulse' />
				<span>Saving to server...</span>
			</div>
		)
	}

	return (
		<div className='flex items-center gap-1.5 rounded-full bg-emerald-950/40 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400 backdrop-blur-md'>
			<Cloud className='h-3.5 w-3.5' />
			<span>Synced with Cloud</span>
		</div>
	)
}
