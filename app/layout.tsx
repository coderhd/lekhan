import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { localeDirection } from '@/lib/i18n/locales'
import { UsageAnalyticsObserver } from '@/components/usage-analytics'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata')
  return { title: t('title'), description: t('description'), icons: { icon: '/lekhan-icon.svg' } }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()])
  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body><NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <UsageAnalyticsObserver />
        {children}
      </NextIntlClientProvider></body>
    </html>
  )
}
