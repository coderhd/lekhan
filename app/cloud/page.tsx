import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Cloud, FileText, Plus } from 'lucide-react'
import CloudSearch from '@/components/cloud-search'
import CloudVaultImport from '@/components/cloud-vault-import'
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
  const tab = view === 'shared' || view === 'invitations' ? view : 'mine'
  const result = tab === 'invitations' ? null : await listCloudPages(account.client, account.subject, tab === 'shared', after).catch(() => null)
  const invitations = tab === 'invitations' && account.email ? await account.client.from('page_invitations')
    .select('token,role,created_at').eq('status', 'pending').eq('invitee_email', account.email.toLowerCase())
    .order('created_at', { ascending: false }).limit(50).returns<{ token: string; role: SharedRole; created_at: string }[]>() : null

  return (
    <main className="cloud-screen">
      <header className="account-header">
        <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
        <div className="cloud-header-actions">
          <Link className="account-link" href="/">Local workspace</Link>
          <CloudSearch />
        </div>
      </header>
      <section className="cloud-library" aria-labelledby="cloud-heading">
        <span className="page-emblem"><Cloud size={22} /></span>
        <h1 id="cloud-heading">Cloud workspace</h1>
        <nav className="cloud-navigation" aria-label="Cloud pages">
          <Link href="/cloud" aria-current={tab === 'mine' ? 'page' : undefined}>My pages</Link>
          <Link href="/cloud?view=shared" aria-current={tab === 'shared' ? 'page' : undefined}>Shared with me</Link>
          <Link href="/cloud?view=invitations" aria-current={tab === 'invitations' ? 'page' : undefined}>Invitations</Link>
        </nav>
        {error && <p className="account-error" role="alert">{error === 'title' ? 'Enter a page title up to 160 characters.' : 'The page could not be created.'}</p>}
        {tab === 'mine' && <div className="cloud-create-row">
          <form action={addCloudPage} className="cloud-create">
            <label>Page title <input name="title" required maxLength={160} placeholder="Name your page" /></label>
            <button className="primary-button"><Plus size={16} /> New page</button>
          </form>
          <CloudVaultImport />
        </div>}
        {tab === 'invitations' ? <>
          {notice === 'declined' && <p role="status">Invitation declined.</p>}
          {invitations?.error ? <p role="alert">Could not load invitations.</p> : invitations?.data.length ?
            <ul className="cloud-pages">{invitations.data.map(invite => <li key={invite.token}>
              <Link href={'/invite/' + invite.token}><FileText size={17} /> {invite.role === 'editor' ? 'Invitation to edit a page' : 'Invitation to view a page'} · <time dateTime={invite.created_at}>{invite.created_at.slice(0, 10)}</time></Link>
            </li>)}</ul> : <p>No pending invitations.</p>}
        </> : !result ? <p role="alert">Cloud pages are unavailable. Refresh this page to try again.</p>
          : result.pages.length
            ? <ul className="cloud-pages">{result.pages.map(page => <li key={page.id}>
              <Link href={'/page/' + page.id}><FileText size={17} /> <span>{page.title}</span></Link>
            </li>)}</ul>
            : <p>{tab === 'shared' ? 'No pages have been shared with you.' : 'Create a page to start your cloud workspace.'}</p>}
        {result?.next && <Link href={'/cloud?' + new URLSearchParams({ ...(tab === 'shared' ? { view: 'shared' } : {}), after: result.next })}>More pages</Link>}
      </section>
    </main>
  )
}
