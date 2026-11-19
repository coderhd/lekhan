'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useTheme } from 'next-themes'
import { LinkProvider } from '@astryxdesign/core/Link'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

export function AstryxProvider({ children }: { children: ReactNode }) {
	const { resolvedTheme } = useTheme()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])
	return (
		<Theme theme={neutralTheme} mode={mounted && resolvedTheme === 'light' ? 'light' : 'dark'}>
			<LinkProvider component={Link}>{children}</LinkProvider>
		</Theme>
	)
}
