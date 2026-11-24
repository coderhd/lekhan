import Link from 'next/link'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import CloudPageEditor from '@/components/cloud-page-editor'
import CloudSearch from '@/components/cloud-search'
import { accountContext, createAuthClient } from '@/lib/auth/server'
import { listCloudChildren, listCloudLinkChoices, pageAccess } from '@/lib/cloud/graph'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncUrl } from '@/lib/sync/config'
import { getTicketSecret } from '@/lib/sync/ticket'
import { addCloudPage } from '@/app/cloud/actions'
import { renameCloudPage } from '@/app/cloud/page-actions'
import { getPublicPage, readPublicContent } from '@/lib/cloud/public-page'
import { PublicPage } from '@/components/public-page'

async function CloudSubpages({ client, id, after }: { client: SupabaseClient; id: string; after?: string }) {
  const children = await listCloudChildren(client, id, after).catch(() => null)
  if (!children?.pages.length) return null
  return <section aria-label="Subpages" className="cloud-subpages">
    <h2>Subpages</h2>
    <ul className="cloud-pages">{children.pages.map(child => <li key={child.id}>
      <Link href={'/page/' + child.id}>{child.title}</Link>
    </li>)}</ul>
    {children.next && <Link href={'/page/' + id + '?children=' + children.next}>More subpages</Link>}
  </section>
}

export default async function CloudPageRoute({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; children?: string }>
}) {
  const { id } = await params
  const account = await accountContext()
  const access = account && await pageAccess(account.client, id, account.subject)
  if (!account || !access?.privateAccess) {
    const client = account?.client ?? await createAuthClient()
    if (!client) notFound()
    const publicPage = await getPublicPage(client, id)
    if (!publicPage) notFound()
    const content = await readPublicContent(client, publicPage).catch(() => null)
    return <PublicPage title={publicPage.title} content={content} />
  }

  const { error, children: after } = await searchParams
  const choices = listCloudLinkChoices(account.client, account.subject, id).catch(() => [])
  const settings = await getTranslations('settings')

  return (
    <main className="cloud-screen">
      <header className="account-header">
        <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> Cloud workspace</Link>
        <div className="cloud-header-actions">
          {access.page.parent_id && <Link className="account-link" href={'/page/' + access.page.parent_id}>Parent page</Link>}
          {access.role === 'owner' && <Link className="account-link" href={'/page/' + id + '/share'}>Share</Link>}
          <Link className="account-link" href="/settings">{settings('title')}</Link>
          <CloudSearch />
        </div>
      </header>
      <article className="cloud-library">
        <h1>{access.page.title}</h1>
        {error && <p role="alert" className="account-error">
          {error === 'title' ? 'Enter a title up to 160 characters.' : 'Could not update the page.'}
        </p>}
        <CloudPageEditor
          key={account.subject + ':' + id + ':' + access.role} page={access.page} linkChoices={choices} role={access.role}
          subject={account.subject} enabled={!!syncUrl() && !!getTicketSecret()}
        />
        <Suspense><CloudSubpages client={account.client} id={id} after={after} /></Suspense>
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
