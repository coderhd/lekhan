import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PrepareOfflineWorkspace } from '@/components/prepare-offline-workspace'
import { authSessionCookie, offlineNotebookScope } from '@/lib/cloud/offline-account'
import WebWorkspace from '@/components/web-workspace'
import { authConfig } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'
import { resolveOwnerWorkspaceEntitlement } from '@/lib/billing/entitlements'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret } from '@/lib/sync/ticket'
import { getPlanLimits } from '@/lib/tier-limits'

export default async function WorkspacePage() {
  const config = authConfig()
  const account = config ? await accountContext() : null
  if (config && !account) {
    const offline = offlineNotebookScope((await cookies()).toString(), authSessionCookie(config.url))
    if (offline !== 'personal') redirect('/workspace-offline')
  }
  const scope = account ? 'account:' + account.subject : 'personal'
  const mirrorEnabled = !!account && !!syncUrl() && !!getTicketSecret()
  const plan = account && mirrorEnabled
    ? await resolveOwnerWorkspaceEntitlement(account.subject, account.client).catch(() => null)
    : null
  return <>
    <PrepareOfflineWorkspace />
    <WebWorkspace key={scope} storageScope={scope} cloudEnabled={!!config} signedIn={!!account}
      profile={account ? { subject: account.subject, email: account.email, displayName: account.displayName } : undefined}
      plan={plan ? { tier: plan.tier, ...getPlanLimits(plan.tier, plan.seats) } : undefined}
      mirrorEnabled={mirrorEnabled} automaticMirror={!!plan && plan.tier !== 'free' && !plan.relayReadOnly} />
  </>
}
