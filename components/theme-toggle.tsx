'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export default function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	if (!mounted) return <span className="ax-theme-placeholder" aria-hidden />
	const isDark = resolvedTheme === 'dark'
	return (
		<button type="button" className="ax-theme-toggle" aria-label="Dark mode" aria-pressed={isDark}
			title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
			onClick={() => setTheme(isDark ? 'light' : 'dark')}>
			{isDark ? <Moon size={19} aria-hidden /> : <Sun size={19} aria-hidden />}
		</button>
	)
}
