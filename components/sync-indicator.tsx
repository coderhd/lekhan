'use client'

import { Cloud, CloudOff, HardDrive, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ConnectionState } from '@/hooks/use-editor-collab'

interface SyncIndicatorProps {
	connectionState: ConnectionState
	isSynced: boolean
	/** Durable local edits that have not reached the hub yet. */
	hasUnsyncedChanges?: boolean
}

type SyncIndicatorState =
	| 'synced'
	| 'saving'
	| 'local-edits-only'
	| 'connecting'
	| 'offline'

interface SyncIndicatorAppearance {
	label: string
	title: string
	icon: LucideIcon
	iconClassName?: string
	chipClassName: string
}

const BASE_CHIP_CLASS =
	'inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur-md'

// Copy follows CONTEXT.md vocabulary: "hub" (server-side sync layer) and
// "this device" (the local replica) — never "server" or "cloud".
const APPEARANCE: Record<SyncIndicatorState, SyncIndicatorAppearance> = {
	synced: {
		label: 'Synced',
		title: 'All changes are synced with the hub.',
		icon: Cloud,
		chipClassName: `${BASE_CHIP_CLASS} bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/20 text-emerald-600 dark:text-emerald-400`,
	},
	saving: {
		label: 'Saving...',
		title: 'Sending your latest edits to the hub.',
		icon: Cloud,
		iconClassName: 'animate-pulse',
		chipClassName: `${BASE_CHIP_CLASS} bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/20 text-amber-600 dark:text-amber-400`,
	},
	'local-edits-only': {
		label: 'Local edits only',
		title: 'These edits are kept on this device and will sync when the hub reconnects.',
		icon: HardDrive,
		chipClassName: `${BASE_CHIP_CLASS} bg-amber-500/10 dark:bg-amber-500/20 border-amber-500/20 text-amber-600 dark:text-amber-400`,
	},
	connecting: {
		label: 'Connecting to hub...',
		// The ~50s Render cold start is a *known* state. Name it rather than
		// hiding it behind an open-ended spinner.
		title: 'Connecting to the hub. It can take up to a minute to wake from idle; your edits stay on this device meanwhile.',
		icon: Loader2,
		iconClassName: 'animate-spin',
		chipClassName: `${BASE_CHIP_CLASS} bg-slate-500/10 dark:bg-slate-400/10 border-slate-500/20 text-slate-600 dark:text-slate-300`,
	},
	offline: {
		label: 'Offline',
		title: 'You are offline. Changes cannot reach the hub right now.',
		icon: CloudOff,
		chipClassName: `${BASE_CHIP_CLASS} bg-red-500/10 dark:bg-red-500/20 border-red-500/20 text-red-600 dark:text-red-400`,
	},
}

/**
 * Precedence matters for truthfulness:
 * - While connected, an in-flight convert is the accurate state ("Saving..."),
 *   even though `hasUnsyncedChanges` is also true during that window.
 * - While disconnected, pending durable edits outrank "Offline"/"Connecting"
 *   because they answer the only question that matters: is my work safe?
 */
function resolveState (
	connectionState: ConnectionState,
	isSynced: boolean,
	hasUnsyncedChanges: boolean
): SyncIndicatorState {
	if (connectionState === 'connected') {
		return isSynced ? 'synced' : 'saving'
	}

	if (hasUnsyncedChanges) {
		return 'local-edits-only'
	}

	return connectionState === 'offline' ? 'offline' : 'connecting'
}

export default function SyncIndicator ({
	connectionState,
	isSynced,
	hasUnsyncedChanges = false,
}: SyncIndicatorProps) {
	const state = resolveState(connectionState, isSynced, hasUnsyncedChanges)
	const { label, title, icon: Icon, iconClassName, chipClassName } = APPEARANCE[state]

	return (
		<div
			role='status'
			aria-live='polite'
			title={title}
			className={chipClassName}
		>
			<Icon className={`h-3.5 w-3.5 ${iconClassName ?? ''}`} />
			<span>{label}</span>
		</div>
	)
}
