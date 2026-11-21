import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import CloudPageEditor from '@/components/cloud-page-editor'
import CloudSearch from '@/components/cloud-search'
import { accountContext } from '@/lib/auth/server'
import { listCloudPages, pageAccess } from '@/lib/cloud/graph'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret } from '@/lib/sync/ticket'
import { addCloudPage } from '@/app/cloud/actions'
import { renameCloudPage } from '@/app/cloud/page-actions'

export default async function CloudPageRoute({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const account = await accountContext()
  if (!account) redirect('/login')
  const access = await pageAccess(account.client, id, account.subject)
  if (!access?.privateAccess) notFound()

  const [owned, shared, { error }] = await Promise.all([
    listCloudPages(account.client, account.subject, false).catch(() => null),
    listCloudPages(account.client, account.subject, true).catch(() => null),
    searchParams,
  ])
  const choices = [...(owned?.pages ?? []), ...(shared?.pages ?? [])].filter(page => page.id !== id)
    .map(page => ({ id: page.id, title: page.title, path: page.title }))

  return (
    <main className="cloud-screen">
      <header className="account-header">
        <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> Cloud workspace</Link>
        <div className="cloud-header-actions">
          {access.page.parent_id && <Link className="account-link" href={'/page/' + access.page.parent_id}>Parent page</Link>}
          <CloudSearch />
        </div>
      </header>
      <article className="cloud-library">
        <h1>{access.page.title}</h1>
        {error && <p role="alert" className="account-error">
          {error === 'title' ? 'Enter a title up to 160 characters.' : 'Could not update the page.'}
        </p>}
        <CloudPageEditor
          key={account.subject + ':' + id} page={access.page} choices={choices}
          subject={account.subject} enabled={!!syncUrl() && !!getTicketSecret()}
        />
        {access.role === 'owner' && <details className="cloud-page-actions">
          <summary>Page settings</summary>
          <form className="cloud-create" action={renameCloudPage.bind(null, id)}>
            <label>Page title <input name="title" defaultValue={access.page.title} maxLength={160} required /></label>
            <button className="secondary-button">Rename</button>
          </form>
          <form className="cloud-create" action={addCloudPage}>
            <input type="hidden" name="parentId" value={id} />
            <label>Subpage title <input name="title" maxLength={160} required /></label>
            <button className="secondary-button">Add subpage</button>
          </form>
        </details>}
      </article>
    </main>
  )
}
