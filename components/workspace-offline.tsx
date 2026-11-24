'use client'

import { useState, useSyncExternalStore } from 'react'
import { CloudOff, Settings2 } from 'lucide-react'
import { offlineNotebookScope } from '@/lib/cloud/offline-account'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSelect from './locale-select'
import { watchOfflineCookies, setOfflineLocale } from './offline-shell'
import { SettingsDialog } from './settings/settings-content'
import WorkspaceApp from './workspace-app'

const pending = () => undefined

export default function WorkspaceOffline({ sessionCookie }: { sessionCookie?: string }) {
  const scope = useSyncExternalStore(watchOfflineCookies, () => offlineNotebookScope(document.cookie, sessionCookie), pending)
  const t = useTranslations('cloud-offline')
  const auth = useTranslations('auth')
  if (!scope) return <main className="cloud-screen">
    <section className="cloud-library">
      <span className="page-emblem"><CloudOff size={22} /></span>
      <h1>{t('notebook')}</h1>
      <p role="status">{scope === undefined ? t('loadingNotebook') : t('signedOut')}</p>
      {scope === null && <a className="account-link" href="/login">{auth('login')}</a>}
    </section>
  </main>
  return <OfflineNotebook key={scope} scope={scope} />
}

function OfflineNotebook({ scope }: { scope: string }) {
  const t = useTranslations('cloud-offline')
  const settings = useTranslations('settings')
  const [settingsOpen, setSettingsOpen] = useState(false)
  return <>
    <WorkspaceApp storageScope={scope} workspaceName={t('notebook')} sidebarControls={<>
      <a className="nav-action account-link" href="/workspace">{t('openNotebookOnline')}</a>
      <LocaleSelect onSelect={setOfflineLocale} />
      <button type="button" className="nav-action" onClick={() => setSettingsOpen(true)}>
        <Settings2 size={16} aria-hidden="true" /> {settings('title')}
      </button>
    </>} />
    {settingsOpen && <SettingsDialog scope={scope} initialTab="editor" workspace={t('notebook')}
      general={<LocaleSelect onSelect={setOfflineLocale} />} onClose={() => setSettingsOpen(false)} />}
  </>
}
