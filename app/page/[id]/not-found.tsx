import { accountContext } from '@/lib/auth/server'
import { PageUnavailable } from '@/components/public-page'

export default async function UnavailablePage() {
  return <PageUnavailable signedIn={!!await accountContext()} />
}
