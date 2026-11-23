'use client'

import { setLocale } from '@/app/locale-actions'
import LocaleSelect from './locale-select'

export default function LocaleSwitcher() {
  return <LocaleSelect onSelect={setLocale} />
}
