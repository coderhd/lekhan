import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { WorkspaceTransferAccept } from '@/components/workspace-transfer'
import { createServerAdmin } from '@/lib/auth/admin'
import { workspaceTransferPath } from '@/lib/auth/input'
import { accountContext } from '@/lib/auth/server'
import { readWorkspaceTransfer } from '@/lib/billing/ownership-transfer'

export async function generateMetadata() {
  const t = await getTranslations('billing')
  return { title: t('transferTitle') + ' · Lekhan', referrer: 'no-referrer', robots: { index: false, follow: false } } as const
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

  const [t, cloud] = await Promise.all([getTranslations('billing'), getTranslations('cloud-workspace')])
  return <main className="account-screen">
    <header className="account-header">
      <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> {cloud('title')}</Link>
    </header>
    <section className="account-card" aria-labelledby="transfer-title">
      <h1 id="transfer-title">{t('transferTitle')}</h1>
      {transfer ? <WorkspaceTransferAccept token={token} /> : <>
        <p>{t('transferLinkUnavailable')}</p>
        <Link className="account-link" href={signIn}>{cloud('switchAccount')}</Link>
      </>}
    </section>
  </main>
}
