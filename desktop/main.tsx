import { invoke } from '@tauri-apps/api/core'
import { Cloud } from 'lucide-react'
import { NextIntlClientProvider } from 'next-intl'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import '@/app/globals.css'
import './desktop.css'
import LocaleSelect from '@/components/locale-select'
import WorkspaceApp from '@/components/workspace-app'
import { getCatalog } from '@/lib/i18n/catalog'
import { localeDirection, resolveLocale, type Locale } from '@/lib/i18n/locales'

type DesktopLocale = { locale: Locale; messages: Awaited<ReturnType<typeof getCatalog>> }
const languageKey = 'lekhan:desktop:language'

function Desktop({ initial }: { initial: DesktopLocale }) {
  const [{ locale, messages }, setLocale] = useState(initial)
  const [launchFailed, setLaunchFailed] = useState(false)
  const [opening, setOpening] = useState(false)

  async function selectLanguage(language: Locale) {
    const next = await getCatalog(language)
    localStorage.setItem(languageKey, language)
    document.documentElement.lang = language
    document.documentElement.dir = localeDirection(language)
    setLocale({ locale: language, messages: next })
  }

  async function openCloud() {
    setOpening(true)
    setLaunchFailed(false)
    try {
      await invoke('open_cloud_workspace')
    } catch {
      setLaunchFailed(true)
    } finally {
      setOpening(false)
    }
  }

  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <WorkspaceApp storageScope="desktop" sidebarControls={<>
      <LocaleSelect onSelect={selectLanguage} />
      <button type="button" className="nav-action account-link" disabled={opening} onClick={() => void openCloud()}>
        <Cloud size={15} /> Cloud workspace
      </button>
      {launchFailed && <p className="locale-error desktop-cloud-error" role="alert">Could not open the cloud workspace. Try again.</p>}
    </>} />
  </NextIntlClientProvider>
}

const locale = resolveLocale(localStorage.getItem(languageKey) ?? navigator.language.split('-')[0])
document.documentElement.lang = locale
document.documentElement.dir = localeDirection(locale)
const messages = await getCatalog(locale)
createRoot(document.getElementById('root')!).render(<Desktop initial={{ locale, messages }} />)
