'use client'

import { useId, useState, type ReactNode } from 'react'
import { CircleUserRound, CreditCard, LockKeyhole, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Heading } from '@astryxdesign/core/Heading'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { VStack } from '@astryxdesign/core/Stack'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { useTranslations } from '@/lib/i18n/client'
import type { LocalAssistantModel } from '../assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'
import AIProviderSettings from './ai-provider-settings'
import { AppearanceSettings } from './appearance-settings'

const sections = [
  ['ai', Sparkles], ['general', CircleUserRound], ['editor', SlidersHorizontal], ['plan', CreditCard], ['privacy', LockKeyhole],
] as const

export type SettingsTab = typeof sections[number][0]
export function settingsTab(value: unknown): SettingsTab {
  return sections.find(([id]) => id === value)?.[0] ?? 'ai'
}

type SettingsContentProps = {
  scope: string
  initialTab?: SettingsTab
  workspace?: ReactNode
  general?: ReactNode
  plan?: ReactNode
  privacy?: ReactNode
  modelLibrary?: ReactNode
  localModel?: LocalAssistantModel
  localModels?: readonly LocalAssistantModel[]
  transport?: ProviderTransport
  onClose?: () => void
  onTabChange?: (tab: SettingsTab) => void
}

export function SettingsContent({ scope, initialTab = 'ai', workspace, general, plan, privacy, modelLibrary, localModel, localModels, transport,
  onClose, onTabChange }: SettingsContentProps) {
  const t = useTranslations('settings')
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const id = useId()
  const provider = { scope, localModel, localModels, transport }

  function select(next: SettingsTab) {
    setTab(next)
    onTabChange?.(next)
  }

  return (
    <VStack gap={4} className="settings-content">
      {!onClose && (
        <header className="settings-heading">
          <Heading level={1}>{t('title')}</Heading>
        </header>
      )}
      <TabList
        className="settings-tabs"
        role="tablist"
        aria-label={t('title')}
        size="lg"
        overflow="visible"
        value={tab}
        onChange={value => select(settingsTab(value))}
        hasDivider
      >
        {sections.map(([section, Icon]) => (
          <Tab
            key={section}
            value={section}
            label={t(section)}
            icon={<Icon size={17} aria-hidden="true" />}
            panelId={id + '-' + section + '-panel'}
          />
        ))}
      </TabList>
      <section className="settings-panel" id={id + '-' + tab + '-panel'} role="tabpanel" tabIndex={0}>
        <VStack gap={3}>
          <Heading level={2}>{t(tab)}</Heading>
          {tab === 'general' && (
            <VStack gap={3}>
              {workspace && (
                <VStack gap={0.5} className="settings-workspace">
                  <Text type="label" weight="semibold">{t('workspace')}</Text>
                  <Text color="secondary">{workspace}</Text>
                </VStack>
              )}
              {general}
            </VStack>
          )}
          {tab === 'editor' && <AppearanceSettings />}
          {tab === 'plan' && (plan ?? <Text color="secondary">{t('localPlan')}</Text>)}
          {tab === 'ai' && (
            <VStack gap={4}>
              {modelLibrary}
              <AIProviderSettings {...provider} panel="models" />
            </VStack>
          )}
          {tab === 'privacy' && (
            <VStack gap={4}>
              {privacy}
              <AIProviderSettings {...provider} panel="privacy" />
            </VStack>
          )}
        </VStack>
      </section>
    </VStack>
  )
}

export function SettingsDialog(props: SettingsContentProps & { onClose: () => void }) {
  const t = useTranslations('settings')
  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open) props.onClose() }} className="settings-dialog" width={720} padding={0}>
      <Layout
        header={<DialogHeader title={t('title')} onOpenChange={open => { if (!open) props.onClose() }} />}
        content={
          <LayoutContent>
            <SettingsContent {...props} />
          </LayoutContent>
        }
      />
    </AstryxDialog>
  )
}
