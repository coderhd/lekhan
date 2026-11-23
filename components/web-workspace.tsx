'use client'

import { Cloud, LogIn, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOut } from '@/app/auth/actions'
import { useTranslations } from '@/lib/i18n/client'
import LocaleSwitcher from './locale-switcher'
import { UsageAnalyticsControl } from './usage-analytics'
import WorkspaceApp from './workspace-app'

export default function WebWorkspace({ storageScope, cloudEnabled, signedIn, mirrorEnabled, automaticMirror }: {
  storageScope: string; cloudEnabled: boolean; signedIn: boolean; mirrorEnabled: boolean; automaticMirror: boolean
}) {
  const router = useRouter()
  const t = useTranslations('auth')
  return <WorkspaceApp storageScope={storageScope} mirrorEnabled={mirrorEnabled} automaticMirror={automaticMirror}
    openCloudPage={signedIn ? id => router.push('/page/' + id) : undefined}
    sidebarControls={<>
      <LocaleSwitcher />
      <UsageAnalyticsControl />
      {cloudEnabled && signedIn && <Link className="nav-action account-link" href="/cloud"><Cloud size={15} /> Cloud workspace</Link>}
      {cloudEnabled && (signedIn
        ? <form action={signOut}><button className="nav-action" type="submit"><LogOut size={15} /> {t('signout')}</button></form>
        : <Link className="nav-action account-link" href="/login"><LogIn size={15} /> {t('login')}</Link>)}
    </>} />
}
