import WorkspaceApp from '@/components/workspace-app'
import { authConfig } from '@/lib/auth/config'
import { accountSubject } from '@/lib/auth/server'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret } from '@/lib/sync/ticket'

export default async function WorkspacePage() {
  const enabled = !!authConfig()
  const subject = enabled ? await accountSubject() : null
  const scope = subject ? 'account:' + subject : 'personal'
  return <WorkspaceApp key={scope} storageScope={scope} cloudEnabled={enabled} signedIn={!!subject}
    mirrorEnabled={!!subject && !!syncUrl() && !!getTicketSecret()} />
}
