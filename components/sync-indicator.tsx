'use client'

import { Cloud, CloudOff } from 'lucide-react'

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
			<div className='inline-flex w-fit items-center gap-1.5 rounded-full bg-red-500/10 dark:bg-red-500/20 border border-red-500/20 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-400 backdrop-blur-md'>
				<CloudOff className='h-3.5 w-3.5' />
				<span>Offline</span>
			</div>
		)
	}

	if (!isSynced) {
		return (
			<div className='inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400 backdrop-blur-md'>
				<Cloud className='h-3.5 w-3.5 animate-pulse' />
				<span>Saving...</span>
			</div>
		)
	}

	return (
		<div className='inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 backdrop-blur-md'>
			<Cloud className='h-3.5 w-3.5' />
			<span>Synced</span>
		</div>
	)
}
