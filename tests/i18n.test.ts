import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { getCatalog, withEnglishFallback } from '../lib/i18n/catalog'
import { localeDirection, locales, resolveLocale } from '../lib/i18n/locales'

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
    const source = await getCatalog('en')
    const translated = await getCatalog(locale)
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
})
