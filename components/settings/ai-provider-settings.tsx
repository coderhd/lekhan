'use client'

import { useSyncExternalStore } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import AssistantDialog, { type LocalAssistantModel } from '../assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'

const subscribeToHydration = () => () => {}

export default function AIProviderSettings({ scope, panel, localModel, localModels, transport }: {
  scope: string
  panel: 'models' | 'privacy'
  localModel?: LocalAssistantModel
  localModels?: readonly LocalAssistantModel[]
  transport?: ProviderTransport
}) {
  const t = useTranslations('settings')
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false)

  return <div className="settings-section">
    <h3>{t(panel === 'models' ? 'providerConnections' : 'providerVault')}</h3>
    {hydrated && <AssistantDialog storageScope={scope} localModel={localModel} localModels={localModels} settingsPanel={panel} transport={transport} />}
  </div>
}
