'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { CloudOff, Settings2 } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { Item } from '@astryxdesign/core/Item'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { offlineNotebookScope } from '@/lib/cloud/offline-account'
import { bootstrapTierGates } from '@/lib/analytics'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSelect from './locale-select'
import { watchOfflineCookies, setOfflineLocale } from './offline-shell'
import { SettingsDialog } from './settings/settings-content'
import { UsageAnalyticsControl } from './usage-analytics'
import WorkspaceApp from './workspace-app'

const pending = () => undefined

export default function WorkspaceOffline({ sessionCookie }: { sessionCookie?: string }) {
  const scope = useSyncExternalStore(watchOfflineCookies, () => offlineNotebookScope(document.cookie, sessionCookie), pending)
  const t = useTranslations('cloud-offline')
  const auth = useTranslations('auth')
  if (!scope) return (
    <main className="cloud-screen">
      <section className="cloud-library">
        <span className="page-emblem"><CloudOff size={22} /></span>
        <h1>{t('notebook')}</h1>
        <Text role="status" color="secondary">{scope === undefined ? t('loadingNotebook') : t('signedOut')}</Text>
        {scope === null && <Button variant="primary" href="/login" label={auth('login')} />}
      </section>
    </main>
  )
  return <OfflineNotebook key={scope} scope={scope} />
}

function OfflineNotebook({ scope }: { scope: string }) {
  const t = useTranslations('cloud-offline')
  const settings = useTranslations('settings')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const cloudSubject = scope.startsWith('account:') ? scope.slice('account:'.length) : undefined
  useEffect(() => { bootstrapTierGates(scope) }, [scope])
  return <>
    <WorkspaceApp storageScope={scope} workspaceName={t('notebook')}
      cloudSearchSubject={cloudSubject}
      openCloudPage={cloudSubject ? id => {
        const target = new URL('/cloud-offline', window.location.origin)
        target.searchParams.set('page', id)
        window.location.assign(target.href)
      } : undefined}
      sidebarControls={<>
        <Item href="/workspace" density="compact" label={t('openNotebookOnline')} />
        {cloudSubject && <Item href="/cloud-offline" density="compact" label={t('title')} />}
        <LocaleSelect onSelect={setOfflineLocale} />
        <Item
          density="compact"
          startContent={<Settings2 size={16} aria-hidden="true" />}
          label={settings('title')}
          onClick={() => setSettingsOpen(true)}
        />
      </>} />
    {settingsOpen && (
      <SettingsDialog
        scope={scope}
        initialTab="editor"
        workspace={t('notebook')}
        general={<LocaleSelect onSelect={setOfflineLocale} />}
        privacy={
          <VStack gap={3} className="settings-section">
            <Text color="secondary">{settings('privacyDescription')}</Text>
            <UsageAnalyticsControl />
          </VStack>
        }
        onClose={() => setSettingsOpen(false)}
      />
    )}
  </>
}
