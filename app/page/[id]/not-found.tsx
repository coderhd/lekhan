import { accountContext } from '@/lib/auth/server'
import { DiscardOfflineAccess } from '@/components/prepare-offline-workspace'
import { PageUnavailable } from '@/components/public-page'

export default async function UnavailablePage() {
  const account = await accountContext()
  return <>
    {account && <DiscardOfflineAccess subject={account.subject} />}
    <PageUnavailable signedIn={!!account} />
  </>
}
