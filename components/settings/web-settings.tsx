'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSwitcher from '../locale-switcher'
import { UsageAnalyticsControl } from '../usage-analytics'
import { SettingsContent, SettingsDialog, settingsTab, type SettingsTab } from './settings-content'
import ProfileSettings, { type SettingsProfile } from './profile-settings'
import type { PlanLimits, PlanTier } from '@/lib/tier-limits'

export default function WebSettings({ scope, profile, plan, planSummary, available, openTab, onClose }: {
  scope: string; profile?: SettingsProfile; plan?: ReactNode; available: boolean; openTab?: string; onClose?: () => void
  planSummary?: PlanLimits & { tier: PlanTier }
}) {
  const t = useTranslations('settings')
  const props = {
    scope,
    initialTab: settingsTab(openTab),
    workspace: t('localWorkspace'),
    general: <>
      {profile ? <ProfileSettings profile={profile} /> : <p>{t('localProfile')}</p>}
      <div className="settings-section"><LocaleSwitcher /></div>
    </>,
    plan: plan ?? <div className="settings-fields">
      <p>{t(profile ? 'planDescription' : 'localPlan')}</p>
      {planSummary && <dl className="settings-plan-summary">
        <div><dt>{t('currentPlan')}</dt><dd>{t('plan_' + planSummary.tier)}</dd></div>
        <div><dt>{t('historyRetention')}</dt><dd>{t('retentionDays', { count: planSummary.historyRetentionDays })}</dd></div>
        <div><dt>{t('collaboratorLimit')}</dt><dd>{planSummary.maxDistinctCollaborators}</dd></div>
      </dl>}
      {profile ? <Link href="/settings?tab=plan" className="account-link">{t('managePlan')}</Link>
        : available && <Link href="/login" className="account-link">{t('signInForPlan')}</Link>}
    </div>,
    privacy: <div className="settings-section">
      <p>{t('privacyDescription')}</p>
      <UsageAnalyticsControl />
    </div>,
  }
  function changeTab(tab: SettingsTab) {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url)
  }
  return onClose ? <SettingsDialog {...props} onClose={onClose} /> : <SettingsContent {...props} onTabChange={changeTab} />
}
