import { locales, type Locale } from '../i18n/locales'

export const marketingPaths = ['/', '/about', '/faq', '/contact'] as const
export type MarketingPath = (typeof marketingPaths)[number]

export function marketingPathForLanguage(path: MarketingPath, locale: Locale) {
  return `/${locale}${path === '/' ? '' : path}`
}

export function marketingLink(path: MarketingPath, locale: Locale) {
  return locale === 'en' ? path : marketingPathForLanguage(path, locale)
}

export function localizedMarketingRoute(pathname: string) {
  const [, prefix, ...rest] = pathname.split('/')
  const locale = locales.find(language => language === prefix)
  const path = marketingPaths.find(candidate => candidate === '/' + rest.join('/'))
  return locale && path ? { locale, path } : null
}
