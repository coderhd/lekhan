import WorkspaceApp from '@/components/workspace-app'
import { authConfig } from '@/lib/auth/config'
import { accountSubject } from '@/lib/auth/server'

export default async function HomePage() {
  const enabled = !!authConfig()
  const subject = enabled ? await accountSubject() : null
  const scope = subject ? 'account:' + subject : 'personal'
  return <WorkspaceApp key={scope} storageScope={scope} cloudEnabled={enabled} signedIn={!!subject} />
}
