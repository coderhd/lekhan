import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { getCatalog } from './catalog'
import { localeCookie, resolveLocale } from './locales'

export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get(localeCookie)?.value)
  return { locale, messages: await getCatalog(locale), timeZone: 'UTC' }
})
