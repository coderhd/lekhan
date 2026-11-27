'use server'

import { cookies } from 'next/headers'
import { localeCookie, locales, type Locale } from '@/lib/i18n/locales'

export async function setLocale(locale: Locale) {
  if (!locales.includes(locale)) throw new Error('Unsupported language')
  const store = await cookies()
  store.set(localeCookie, locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60,
  })
}
