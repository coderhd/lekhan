import type { Metadata } from 'next'
import { siteOrigin } from '../auth/config'
import { locales, type Locale } from '../i18n/locales'
import { marketingPathForLanguage, type MarketingPath } from './routes'

export function marketingLanguageUrls(path: MarketingPath, origin: string) {
  return {
    ...Object.fromEntries(locales.map(locale => [locale, new URL(marketingPathForLanguage(path, locale), origin).href])),
    'x-default': new URL(path, origin).href,
  }
}

export function marketingMetadata(path: MarketingPath, locale: Locale, title: string, description: string): Metadata {
  const origin = siteOrigin()
  const canonical = origin ? new URL(marketingPathForLanguage(path, locale), origin).href : undefined
  return {
    title, description,
    alternates: origin ? { canonical, languages: marketingLanguageUrls(path, origin) } : undefined,
    openGraph: { title, description, url: canonical, siteName: 'Lekhan' },
  }
}
