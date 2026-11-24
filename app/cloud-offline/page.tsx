import type { Metadata } from 'next'
import CloudOffline from '@/components/cloud-offline'
import { getCatalog } from '@/lib/i18n/catalog'
import { locales } from '@/lib/i18n/locales'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function CloudOfflinePage() {
  const rows = await Promise.all(locales.map(async locale => {
    const catalog = await getCatalog(locale)
    return [locale, {
      'cloud-offline': catalog['cloud-offline'],
      'cloud-export': catalog['cloud-export'],
      'editor-chrome': catalog['editor-chrome'],
      'editor-ai': catalog['editor-ai'],
    }] as const
  }))
  return <CloudOffline catalogs={Object.fromEntries(rows)} />
}
