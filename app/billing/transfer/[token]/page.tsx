import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { WorkspaceTransferAccept } from '@/components/workspace-transfer'
import { createServerAdmin } from '@/lib/auth/admin'
import { workspaceTransferPath } from '@/lib/auth/input'
import { accountContext } from '@/lib/auth/server'
import { readWorkspaceTransfer } from '@/lib/billing/ownership-transfer'

export const metadata = {
  title: 'Workspace ownership transfer · Lekhan',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

export default async function TransferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!workspaceTransferPath(token)) notFound()
  const signIn = '/login?' + new URLSearchParams({ transfer: token })
  const account = await accountContext()
  if (!account) redirect(signIn)
  const admin = createServerAdmin()
  const transfer = admin && await readWorkspaceTransfer(admin, token, account.subject).catch(() => null)
  if (transfer?.accepted_at) redirect('/billing')

  return <main className="account-screen">
    <header className="account-header">
      <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> Cloud workspace</Link>
    </header>
    <section className="account-card" aria-labelledby="transfer-title">
      <h1 id="transfer-title">Workspace ownership transfer</h1>
      {transfer ? <WorkspaceTransferAccept token={token} /> : <>
        <p>This link is unavailable. Sign in with the account the owner invited, or ask for a new link.</p>
        <Link className="account-link" href={signIn}>Sign in with another account</Link>
      </>}
    </section>
  </main>
}
