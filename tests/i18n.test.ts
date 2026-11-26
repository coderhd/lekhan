import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { getCatalog, loadRawCatalog, withEnglishFallback } from '../lib/i18n/catalog'
import { localeDirection, locales, resolveLocale } from '../lib/i18n/locales'
import { marketingLanguageUrls } from '../lib/marketing/metadata'
import { localizedMarketingRoute } from '../lib/marketing/routes'

describe('workspace locale', () => {
  it('honors a supported preference and defaults to English for unknown values', () => {
    expect(resolveLocale('hi')).toBe('hi')
    expect(resolveLocale('xx')).toBe('en')
    expect(resolveLocale('__proto__')).toBe('en')
    expect(resolveLocale()).toBe('en')
  })

  it('derives direction from the language subtag', () => {
    expect(localeDirection('hi')).toBe('ltr')
    expect(localeDirection('ar-EG')).toBe('rtl')
    expect(localeDirection('arn')).toBe('ltr')
  })
})

describe('workspace catalogs', () => {
  it.each(locales)('ships complete, nonempty %s catalogs with no extra keys', async (locale) => {
    const source = await loadRawCatalog('en')
    const translated = await loadRawCatalog(locale)
    expect(Object.keys(translated).sort()).toEqual(Object.keys(source).sort())
    for (const namespace of Object.keys(source) as (keyof typeof source)[]) {
      expect(Object.keys(translated[namespace]).sort()).toEqual(Object.keys(source[namespace]).sort())
      expect(Object.values(translated[namespace]).every((message) => message.trim().length > 0)).toBe(true)
    }
  })

  it('uses English for missing and blank translations', () => {
    expect(withEnglishFallback(
      { existing: 'English', blank: 'Fallback', missing: 'Source' },
      { existing: 'Español', blank: ' ' },
    )).toEqual({ existing: 'Español', blank: 'Fallback', missing: 'Source' })
  })

  it('formats counts and inserts user titles into translated chrome', async () => {
    const en = createTranslator({ locale: 'en', messages: await getCatalog('en') })
    const es = createTranslator({ locale: 'es', messages: await getCatalog('es') })

    expect(en('editor-chrome.wordCount', { count: 1 })).toBe('1 word')
    expect(en('editor-chrome.wordCount', { count: 2 })).toBe('2 words')
    expect(es('editor-chrome.wordCount', { count: 2 })).toBe('2 palabras')
    expect(es('app-shell.deletePageTitle', { title: 'Roadmap' })).toBe('¿Eliminar Roadmap?')
  })

  it.each(locales)('formats cloud access labels and link counts in %s', async locale => {
    const translate = createTranslator({ locale, messages: await getCatalog(locale), namespace: 'cloud-workspace' })
    expect(translate('accessFor', { person: 'ada@example.test' })).toContain('ada@example.test')
    expect(translate('pageLinks', { count: 1250 })).toContain(new Intl.NumberFormat(locale).format(1250))
  })

  it.each(locales)('formats file names and checkpoint retention in %s', async locale => {
    const translate = createTranslator({ locale, messages: await getCatalog(locale), namespace: 'cloud-dialogs' })
    expect(translate('downloadFile', { name: 'Field notes {2026}.pdf' })).toContain('Field notes {2026}.pdf')
    expect(translate('backupName', { name: 'First draft' })).toContain('First draft')
    const retention = translate('checkpointRetention', { days: 1250 })
    expect(retention).toContain(new Intl.NumberFormat(locale).format(1250))
    expect(translate('checkpointRetention', { days: 1 })).not.toEqual(retention)
  })
})

describe('public language routes', () => {
  it('exposes each translation and keeps private paths out of the localized route set', () => {
    expect(localizedMarketingRoute('/hi')).toEqual({ locale: 'hi', path: '/' })
    expect(localizedMarketingRoute('/es/faq')).toEqual({ locale: 'es', path: '/faq' })
    expect(localizedMarketingRoute('/es/page/private-note')).toBeNull()
    expect(localizedMarketingRoute('/xx/faq')).toBeNull()
    expect(marketingLanguageUrls('/about', 'https://lekhan.example')).toEqual({
      en: 'https://lekhan.example/en/about', hi: 'https://lekhan.example/hi/about',
      zh: 'https://lekhan.example/zh/about', es: 'https://lekhan.example/es/about',
      de: 'https://lekhan.example/de/about', 'x-default': 'https://lekhan.example/about',
    })
  })
})
