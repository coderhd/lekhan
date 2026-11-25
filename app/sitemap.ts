import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/auth/config'
import { locales } from '@/lib/i18n/locales'
import { marketingLanguageUrls } from '@/lib/marketing/metadata'
import { marketingPathForLanguage, marketingPaths } from '@/lib/marketing/routes'

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin()
  if (!origin) return []
  return marketingPaths.flatMap(path => locales.map(locale => ({
    url: new URL(marketingPathForLanguage(path, locale), origin).href,
    alternates: { languages: marketingLanguageUrls(path, origin) },
  })))
}
