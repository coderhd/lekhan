'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { LinkProvider } from '@astryxdesign/core/Link'
import { Theme } from '@astryxdesign/core/theme'
import { usePathname } from 'next/navigation'
import { lekhanTheme } from '@/lib/lekhan'
import '@/lib/lekhan.css'
import { useEditorPreferences } from '@/components/settings/appearance-settings'

const darkCapablePrefix = ['/workspace', '/workspace-offline', '/settings', '/cloud', '/cloud-offline']

export function useResolvedEditorTheme() {
  const { theme } = useEditorPreferences()
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setPrefersDark(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}

export function AstryxProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const resolved = useResolvedEditorTheme()
  const supportsEditorTheme = darkCapablePrefix.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))
  const mode = supportsEditorTheme ? resolved : 'light'

  return (
    <Theme theme={lekhanTheme} mode={mode}>
      <LinkProvider component={Link}>{children}</LinkProvider>
    </Theme>
  )
}
