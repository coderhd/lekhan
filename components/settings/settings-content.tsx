'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CircleUserRound, CreditCard, LockKeyhole, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import type { LocalAssistantModel } from '../assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'
import AIProviderSettings from './ai-provider-settings'
import { Dialog } from '../workspace-dialogs'
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
  const controls = useRef<HTMLButtonElement[]>([])
  const provider = { scope, localModel, localModels, transport }

  function select(next: SettingsTab) {
    setTab(next)
    onTabChange?.(next)
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = sections.length - 1
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      next = (index + (forward ? 1 : -1) + sections.length) % sections.length
    } else return
    event.preventDefault()
    select(sections[next][0])
    controls.current[next]?.focus()
  }

  return <div className="settings-content">
    <header className="settings-heading">
      {onClose ? <h2>{t('title')}</h2> : <h1>{t('title')}</h1>}
      {onClose && <button type="button" className="icon-button" aria-label={t('close')} onClick={onClose}><X size={20} aria-hidden="true" /></button>}
    </header>
    <div className="settings-layout">
      <div className="settings-tabs" role="tablist" aria-label={t('title')}>
        {sections.map(([section, Icon], index) => <button type="button" key={section} ref={element => {
          if (element) controls.current[index] = element
        }} role="tab" id={id + '-' + section} tabIndex={tab === section ? 0 : -1} aria-selected={tab === section}
          aria-controls={id + '-panel'} onKeyDown={event => keyboard(event, index)} onClick={() => select(section)}>
          <Icon size={17} aria-hidden="true" /> <span>{t(section)}</span>
        </button>)}
      </div>
      <section className="settings-panel" id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-' + tab} tabIndex={0}>
        <h2>{t(tab)}</h2>
        {tab === 'general' && <>
          {workspace && <div className="settings-workspace"><strong>{t('workspace')}</strong><p>{workspace}</p></div>}
          {general}
        </>}
        {tab === 'editor' && <AppearanceSettings />}
        {tab === 'plan' && (plan ?? <p>{t('localPlan')}</p>)}
        {tab === 'ai' && <>
          {modelLibrary}
          <AIProviderSettings {...provider} panel="models" />
        </>}
        {tab === 'privacy' && <>
          {privacy}
          <AIProviderSettings {...provider} panel="privacy" />
        </>}
      </section>
    </div>
  </div>
}

export function SettingsDialog(props: SettingsContentProps & { onClose: () => void }) {
  const t = useTranslations('settings')
  return <Dialog title={t('title')} className="settings-dialog" onClose={props.onClose}>
    <SettingsContent {...props} />
  </Dialog>
}
