export const locales = ['en', 'hi', 'zh', 'es', 'de'] as const
export type Locale = (typeof locales)[number]

export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  zh: '中文',
  es: 'Español',
  de: 'Deutsch',
}

export const localeCookie = 'lek-locale'

export function resolveLocale(value?: string): Locale {
  return locales.find(locale => locale === value) ?? 'en'
}

export function localeDirection(value: string) {
  const [language] = value.toLowerCase().split('-')
  return ['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi'].includes(language) ? 'rtl' : 'ltr'
}
