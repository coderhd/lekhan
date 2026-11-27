'use client'

import { Cloud, LogIn, LogOut, Settings2 } from 'lucide-react'
import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Item } from '@astryxdesign/core/Item'
import { signOut } from '@/app/auth/actions'
import { bootstrapTierGates } from '@/lib/analytics'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSwitcher from './locale-switcher'
import WorkspaceApp from './workspace-app'
import WebSettings from './settings/web-settings'
import type { SettingsProfile } from './settings/profile-settings'
import type { PlanLimits, PlanTier } from '@/lib/tier-limits'

export default function WebWorkspace({ storageScope, cloudEnabled, signedIn, mirrorEnabled, automaticMirror, profile, plan }: {
  storageScope: string; cloudEnabled: boolean; signedIn: boolean; mirrorEnabled: boolean; automaticMirror: boolean
  profile?: SettingsProfile
  plan?: (PlanLimits & { tier: PlanTier; relayReadOnly: boolean }) | null
}) {
  const router = useRouter()
  const t = useTranslations('auth')
  const settings = useTranslations('settings')
  const cloud = useTranslations('cloud-workspace')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!signedIn) {
      bootstrapTierGates(storageScope, null)
      return
    }
    bootstrapTierGates(storageScope, plan && {
      tier: plan.tier,
      seats: plan.tier === 'team' ? plan.maxDistinctCollaborators : undefined,
      relayReadOnly: plan.relayReadOnly,
    })
  }, [plan, signedIn, storageScope])
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
      <Item
        density="compact"
        startContent={<Settings2 size={16} aria-hidden="true" />}
        label={settings('title')}
        onClick={() => setOpen(true)}
      />
      {cloudEnabled && signedIn && (
        <Item
          as={NextLink}
          density="compact"
          startContent={<Cloud size={15} aria-hidden="true" />}
          label={cloud('title')}
          href="/cloud"
        />
      )}
      {signedIn ? (
        <form action={signOut}>
          <button type="submit" className="nav-action">
            <LogOut size={15} aria-hidden="true" /> {t('signout')}
          </button>
        </form>
      ) : (
        <Item
          as={NextLink}
          density="compact"
          startContent={<LogIn size={15} aria-hidden="true" />}
          label={t('login')}
          href="/login"
        />
      )}
    </>} />
    {open && <WebSettings scope={storageScope} profile={profile} available={cloudEnabled} planSummary={plan ?? undefined} onClose={() => setOpen(false)} />}
  </>
}
