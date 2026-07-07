'use client'

import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import type { ConnectionState } from '@/hooks/use-editor-collab'

interface SyncIndicatorProps {
	connectionState: ConnectionState
	isSynced: boolean
}

export default function SyncIndicator ({
	connectionState,
	isSynced,
}: SyncIndicatorProps) {
	if (connectionState === 'offline') {
		return (
			<div className='inline-flex w-fit items-center gap-1.5 rounded-full bg-red-500/10 dark:bg-red-500/20 border border-red-500/20 px-3 py-1 text-xs font-semibold text-red-600 dark:text-red-400 backdrop-blur-md'>
				<CloudOff className='h-3.5 w-3.5' />
				<span>Offline</span>
			</div>
		)
	}

	if (connectionState === 'connecting') {
		// Optimistic, non-alarming state: covers both a brief reconnect blip
		// and the ~50s Render cold-start window. The person is not told
		// anything is wrong — just that we're reconnecting — because their
		// edits keep working locally regardless.
		return (
			<div className='inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-500/10 dark:bg-slate-400/10 border border-slate-500/20 px-3 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 backdrop-blur-md'>
				<Loader2 className='h-3.5 w-3.5 animate-spin' />
				<span>Connecting...</span>
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
