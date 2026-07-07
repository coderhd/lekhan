'use client'

import { WifiOff } from 'lucide-react'

export default function OfflineBanner () {
	return (
		<div className="min-h-[36px] py-1.5 px-6 md:px-10 flex justify-center items-center bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-semibold">
			<WifiOff className="mr-2 h-3.5 w-3.5 shrink-0" />
			You&apos;re offline. Changes are saved locally and will sync once you&apos;re back online.
		</div>
	)
}
