import type { Metadata } from 'next'
import OfflineShell from '@/components/offline-shell'
import WorkspaceOffline from '@/components/workspace-offline'
import { authConfig } from '@/lib/auth/config'
import { authSessionCookie } from '@/lib/cloud/offline-account'
import { getCatalog } from '@/lib/i18n/catalog'
import { locales } from '@/lib/i18n/locales'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function WorkspaceOfflinePage() {
  const config = authConfig()
  const catalogs = await Promise.all(locales.map(async locale => {
    const catalog = await getCatalog(locale)
    return [locale, {
      'cloud-offline': catalog['cloud-offline'],
      'cloud-dialogs': catalog['cloud-dialogs'],
      'app-shell': catalog['app-shell'],
      'editor-chrome': catalog['editor-chrome'],
      'editor-ai': catalog['editor-ai'],
      'vault-import': catalog['vault-import'],
      auth: catalog.auth,
      desktop: catalog.desktop,
      settings: catalog.settings,
    }] as const
  }))
  return <OfflineShell catalogs={Object.fromEntries(catalogs)}>
    <WorkspaceOffline sessionCookie={config ? authSessionCookie(config.url) : undefined} />
  </OfflineShell>
}
