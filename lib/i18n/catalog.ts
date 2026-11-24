import en from './messages/en.json'
import type { Locale } from './locales'

type Catalog = typeof en
const load = {
  en: async () => en,
  hi: async () => (await import('./messages/hi.json')).default,
  zh: async () => (await import('./messages/zh.json')).default,
  es: async () => (await import('./messages/es.json')).default,
  de: async () => (await import('./messages/de.json')).default,
} satisfies Record<Locale, () => Promise<Catalog>>

export function withEnglishFallback<T extends Record<string, string>>(source: T, translated: Partial<T>): T {
  return Object.fromEntries(Object.entries(source).map(([key, fallback]) => [
    key, translated[key]?.trim() ? translated[key] : fallback,
  ])) as T
}

export function loadRawCatalog(locale: Locale) {
  return load[locale]()
}

export async function getCatalog(locale: Locale): Promise<Catalog> {
  const translated = await loadRawCatalog(locale)
  return {
    desktop: withEnglishFallback(en.desktop, translated.desktop),
    'app-shell': withEnglishFallback(en['app-shell'], translated['app-shell']),
    'editor-ai': withEnglishFallback(en['editor-ai'], translated['editor-ai']),
    'cloud-export': withEnglishFallback(en['cloud-export'], translated['cloud-export']),
    'editor-chrome': withEnglishFallback(en['editor-chrome'], translated['editor-chrome']),
    settings: withEnglishFallback(en.settings, translated.settings),
    metadata: withEnglishFallback(en.metadata, translated.metadata),
    auth: withEnglishFallback(en.auth, translated.auth),
    'public-page': withEnglishFallback(en['public-page'], translated['public-page']),
    'early-access': withEnglishFallback(en['early-access'], translated['early-access']),
    marketing: withEnglishFallback(en.marketing, translated.marketing),
  }
}
