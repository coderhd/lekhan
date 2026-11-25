'use client'

import { setLocale } from '@/app/locale-actions'
import { marketingPathForLanguage, type MarketingPath } from '@/lib/marketing/routes'
import LocaleSelect from './locale-select'

export default function LocaleSwitcher({ path }: { path?: MarketingPath }) {
  return <LocaleSelect onSelect={path ? async locale => {
    window.location.assign(marketingPathForLanguage(path, locale) + window.location.search + window.location.hash)
  } : setLocale} />
}
