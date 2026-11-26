'use client'

import { Cloud, LogIn, LogOut, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { signOut } from '@/app/auth/actions'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSwitcher from './locale-switcher'
import { UsageAnalyticsControl } from './usage-analytics'
import WorkspaceApp from './workspace-app'
import WebSettings from './settings/web-settings'
import type { SettingsProfile } from './settings/profile-settings'
import type { PlanLimits, PlanTier } from '@/lib/tier-limits'

export default function WebWorkspace({ storageScope, cloudEnabled, signedIn, mirrorEnabled, automaticMirror, profile, plan }: {
  storageScope: string; cloudEnabled: boolean; signedIn: boolean; mirrorEnabled: boolean; automaticMirror: boolean
  profile?: SettingsProfile
  plan?: PlanLimits & { tier: PlanTier }
}) {
  const router = useRouter()
  const t = useTranslations('auth')
  const settings = useTranslations('settings')
  const cloud = useTranslations('cloud-workspace')
  const [open, setOpen] = useState(false)
  return <><WorkspaceApp storageScope={storageScope} mirrorEnabled={mirrorEnabled} automaticMirror={automaticMirror}
    cloudSearchSubject={profile?.subject}
    openCloudPage={signedIn ? id => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const target = new URL('/cloud-offline', window.location.origin)
        target.searchParams.set('page', id)
        window.location.assign(target.href)
        return
      }
      router.push('/page/' + id)
    } : undefined}
    sidebarControls={<>
      <LocaleSwitcher />
      <UsageAnalyticsControl />
      <button type="button" className="nav-action" onClick={() => setOpen(true)}><Settings2 size={16} aria-hidden="true" /> {settings('title')}</button>
      {cloudEnabled && signedIn && <Link className="nav-action account-link" href="/cloud"><Cloud size={15} /> {cloud('title')}</Link>}
      {signedIn
        ? <form action={signOut}><button className="nav-action" type="submit"><LogOut size={15} /> {t('signout')}</button></form>
        : <Link className="nav-action account-link" href="/login"><LogIn size={15} /> {t('login')}</Link>}
    </>} />
    {open && <WebSettings scope={storageScope} profile={profile} available={cloudEnabled} planSummary={plan} onClose={() => setOpen(false)} />}
  </>
}
