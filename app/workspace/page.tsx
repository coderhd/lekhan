import WorkspaceApp from '@/components/workspace-app'
import { authConfig } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'
import { resolveOwnerWorkspaceEntitlement } from '@/lib/billing/entitlements'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret } from '@/lib/sync/ticket'

export default async function WorkspacePage() {
  const enabled = !!authConfig()
  const account = enabled ? await accountContext() : null
  const scope = account ? 'account:' + account.subject : 'personal'
  const mirrorEnabled = !!account && !!syncUrl() && !!getTicketSecret()
  const plan = account && mirrorEnabled
    ? await resolveOwnerWorkspaceEntitlement(account.subject, account.client).catch(() => null)
    : null
  return <WorkspaceApp key={scope} storageScope={scope} cloudEnabled={enabled} signedIn={!!account}
    mirrorEnabled={mirrorEnabled} automaticMirror={!!plan && plan.tier !== 'free' && !plan.relayReadOnly} />
}
