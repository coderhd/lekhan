import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Cloud, FileText, Plus } from 'lucide-react'
import CloudSearch from '@/components/cloud-search'
import { accountContext } from '@/lib/auth/server'
import { listCloudPages } from '@/lib/cloud/graph'
import { addCloudPage } from './actions'

export default async function CloudWorkspace({ searchParams }: {
  searchParams: Promise<{ view?: string; after?: string; error?: string }>
}) {
  const account = await accountContext()
  if (!account) redirect('/login')
  const { after, error, view } = await searchParams
  const shared = view === 'shared'
  const result = await listCloudPages(account.client, account.subject, shared, after).catch(() => null)

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
          <Link href="/cloud" aria-current={!shared ? 'page' : undefined}>My pages</Link>
          <Link href="/cloud?view=shared" aria-current={shared ? 'page' : undefined}>Shared with me</Link>
        </nav>
        {error && <p className="account-error" role="alert">{error === 'title' ? 'Enter a page title up to 160 characters.' : 'The page could not be created.'}</p>}
        {!shared && <form action={addCloudPage} className="cloud-create">
          <label>Page title <input name="title" required maxLength={160} placeholder="Name your page" /></label>
          <button className="primary-button"><Plus size={16} /> New page</button>
        </form>}
        {!result ? <p role="alert">Cloud pages are unavailable. Refresh this page to try again.</p>
          : result.pages.length
            ? <ul className="cloud-pages">{result.pages.map(page => <li key={page.id}>
              <Link href={'/page/' + page.id}><FileText size={17} /> <span>{page.title}</span></Link>
            </li>)}</ul>
            : <p>{shared ? 'No pages have been shared with you.' : 'Create a page to start your cloud workspace.'}</p>}
        {result?.next && <Link href={'/cloud?' + new URLSearchParams({ ...(shared ? { view: 'shared' } : {}), after: result.next })}>More pages</Link>}
      </section>
    </main>
  )
}
