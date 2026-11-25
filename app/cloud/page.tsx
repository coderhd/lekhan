import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Cloud, FileText, Plus } from 'lucide-react'
import CloudSearch from '@/components/cloud-search'
import { PrepareOfflineWorkspace } from '@/components/prepare-offline-workspace'
import CloudVaultImport from '@/components/cloud-vault-import'
import { UsageAnalyticsControl } from '@/components/usage-analytics'
import { accountContext } from '@/lib/auth/server'
import { listCloudPages } from '@/lib/cloud/graph'
import type { SharedRole } from '@/lib/cloud/sharing'
import { addCloudPage } from './actions'

export default async function CloudWorkspace({ searchParams }: {
  searchParams: Promise<{ view?: string; after?: string; error?: string; notice?: string }>
}) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const { after, error, view, notice } = await searchParams
  const [settings, offline, t, format] = await Promise.all([getTranslations('settings'),
    getTranslations('cloud-offline'), getTranslations('cloud-workspace'), getFormatter()])
  const tab = view === 'shared' || view === 'invitations' ? view : 'mine'
  const result = tab === 'invitations' ? null : await listCloudPages(account.client, account.subject, tab === 'shared', after).catch(() => null)
  const invitations = tab === 'invitations' && account.email ? await account.client.from('page_invitations')
    .select('token,role,created_at').eq('status', 'pending').eq('invitee_email', account.email.toLowerCase())
    .order('created_at', { ascending: false }).limit(50).returns<{ token: string; role: SharedRole; created_at: string }[]>() : null

  return (
    <main className="cloud-screen">
      <PrepareOfflineWorkspace />
      <header className="account-header">
        <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
        <div className="cloud-header-actions">
          <Link className="account-link" href="/settings">{settings('title')}</Link>
          <Link className="account-link" href="/workspace">{t('localWorkspace')}</Link>
          <CloudSearch subject={account.subject} />
          <a className="account-link" href="/cloud-offline">{offline('title')}</a>
        </div>
      </header>
      <section className="cloud-library" aria-labelledby="cloud-heading">
        <span className="page-emblem"><Cloud size={22} /></span>
        <h1 id="cloud-heading">{t('title')}</h1>
        <nav className="cloud-navigation" aria-label={t('navigation')}>
          <Link href="/cloud" aria-current={tab === 'mine' ? 'page' : undefined}>{t('myPages')}</Link>
          <Link href="/cloud?view=shared" aria-current={tab === 'shared' ? 'page' : undefined}>{t('sharedWithMe')}</Link>
          <Link href="/cloud?view=invitations" aria-current={tab === 'invitations' ? 'page' : undefined}>{t('invitations')}</Link>
        </nav>
        {error && <p className="account-error" role="alert">{error === 'title' ? t('titleLimit') : t('createFailed')}</p>}
        {tab === 'mine' && <div className="cloud-create-row">
          <form action={addCloudPage} className="cloud-create">
            <label>{t('pageTitle')} <input name="title" required maxLength={160} placeholder={t('namePage')} /></label>
            <button className="primary-button"><Plus size={16} /> {t('newPage')}</button>
          </form>
          <CloudVaultImport />
        </div>}
        {tab === 'invitations' ? <>
          {notice === 'declined' && <p role="status">{t('invitationDeclined')}</p>}
          {invitations?.error ? <p role="alert">{t('invitationsUnavailable')}</p> : invitations?.data.length ?
            <ul className="cloud-pages">{invitations.data.map(invite => <li key={invite.token}>
              <Link href={'/invite/' + invite.token}><FileText size={17} /> {invite.role === 'editor' ? t('inviteToEdit') : t('inviteToView')} · <time dateTime={invite.created_at}>{format.dateTime(new Date(invite.created_at), { dateStyle: 'medium' })}</time></Link>
            </li>)}</ul> : <p>{t('noInvitations')}</p>}
        </> : !result ? <p role="alert">{t('pagesUnavailable')}</p>
          : result.pages.length
            ? <ul className="cloud-pages">{result.pages.map(page => <li key={page.id}>
              <Link href={'/page/' + page.id}><FileText size={17} /> <span>{page.title}</span></Link>
            </li>)}</ul>
            : <p>{tab === 'shared' ? t('sharedEmpty') : t('mineEmpty')}</p>}
        {result?.next && <Link href={'/cloud?' + new URLSearchParams({ ...(tab === 'shared' ? { view: 'shared' } : {}), after: result.next })}>{t('morePages')}</Link>}
      </section>
      <UsageAnalyticsControl />
    </main>
  )
}
