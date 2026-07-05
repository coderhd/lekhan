'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export default function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme()
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		setMounted(true)
	}, [])

	if (!mounted) {
		return <div className="h-7 w-12" />
	}

	const isDark = resolvedTheme === 'dark'

	return (
		<button
			onClick={() => setTheme(isDark ? 'light' : 'dark')}
			className="relative inline-flex h-7 w-12 items-center rounded-full bg-black/10 dark:bg-white/10 border border-black/20 dark:border-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-container/50 hover:bg-black/20 dark:hover:bg-white/20"
			title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
		>
			<span className="sr-only">Toggle theme</span>
			<span
				className={`flex items-center justify-center h-5 w-5 transform rounded-full shadow-md border border-black/10 dark:border-transparent transition-transform duration-200 ${
					isDark ? 'translate-x-[22px] bg-primary-container' : 'translate-x-1 bg-white'
				}`}
			>
				{isDark ? (
					<Moon className="h-3 w-3 text-on-primary-container" />
				) : (
					<Sun className="h-3 w-3 text-amber-500" />
				)}
			</span>
		</button>
	)
}
