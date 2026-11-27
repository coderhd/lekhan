import Link from 'next/link'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import CloudPageEditor from '@/components/cloud-page-editor'
import CloudSearch from '@/components/cloud-search'
import { DiscardOfflineAccess, PrepareOfflineWorkspace } from '@/components/prepare-offline-workspace'
import { accountContext, createAuthClient } from '@/lib/auth/server'
import { listCloudBacklinks, listCloudChildren, listCloudLinkChoices, pageAccess } from '@/lib/cloud/graph'
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
  const t = await getTranslations('cloud-workspace')
  return <section aria-label={t('subpages')} className="cloud-subpages">
    <h2>{t('subpages')}</h2>
    <ul className="cloud-pages">{children.pages.map(child => <li key={child.id}>
      <Link href={'/page/' + child.id}>{child.title}</Link>
    </li>)}</ul>
    {children.next && <Link href={'/page/' + id + '?children=' + children.next}>{t('moreSubpages')}</Link>}
  </section>
}

async function CloudBacklinks({ client, id, after }: { client: SupabaseClient; id: string; after?: string }) {
  const backlinks = await listCloudBacklinks(client, id, after).catch(() => null)
  if (!backlinks?.pages.length) return null
  const t = await getTranslations('app-shell')
  return (
    <Collapsible trigger={<Text weight="semibold">{t('backlinks')}</Text>} defaultIsOpen={after !== undefined} className="cloud-page-actions">
      <VStack gap={2}>
        <ul className="cloud-pages">{backlinks.pages.map(page => <li key={page.id}>
          <Link href={'/page/' + page.id}>{page.title}</Link>
        </li>)}</ul>
        {backlinks.next && <Link href={'/page/' + id + '?backlinks=' + backlinks.next}>{t('showMoreBacklinks')}</Link>}
      </VStack>
    </Collapsible>
  )
}

export default async function CloudPageRoute({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; children?: string; backlinks?: string }>
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
    return <>
      {account && <DiscardOfflineAccess subject={account.subject} />}
      <PublicPage title={publicPage.title} content={content} />
    </>
  }

  const { error, children: after, backlinks } = await searchParams
  const choices = listCloudLinkChoices(account.client, account.subject, access.page).catch(() => [])
  const [settings, t] = await Promise.all([getTranslations('settings'), getTranslations('cloud-workspace')])

  return (
    <main className="cloud-screen">
      <PrepareOfflineWorkspace />
      <header className="account-header">
        <Link className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> {t('title')}</Link>
        <div className="cloud-header-actions">
          {access.page.parent_id && <Link className="account-link" href={'/page/' + access.page.parent_id}>{t('parentPage')}</Link>}
          {access.role === 'owner' && <Link className="account-link" href={'/page/' + id + '/share'}>{t('share')}</Link>}
          <Link className="account-link" href="/settings">{settings('title')}</Link>
          <CloudSearch subject={account.subject} />
        </div>
      </header>
      <article className="cloud-library">
        <h1>{access.page.title}</h1>
        {error && (
          <div role="alert">
            <Banner status="error" collapsible={false} title={error === 'title' ? t('titleLimit') : t('updateFailed')} />
          </div>
        )}
        <CloudPageEditor
          key={account.subject + ':' + id + ':' + access.role} page={access.page} linkChoices={choices} role={access.role}
          subject={account.subject} enabled={!!syncUrl() && !!getTicketSecret()}
        />
        <Suspense><CloudSubpages client={account.client} id={id} after={after} /></Suspense>
        <Suspense><CloudBacklinks client={account.client} id={id} after={backlinks} /></Suspense>
        {access.role === 'owner' && (
          <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">{t('pageSettings')}</Text>} className="cloud-page-actions">
            <VStack gap={3}>
              <form className="cloud-create" action={renameCloudPage.bind(null, id)}>
                <label>{t('pageTitle')} <input name="title" defaultValue={access.page.title} maxLength={160} required /></label>
                <Button type="submit" variant="secondary" size="sm" label={t('rename')} />
              </form>
              <form className="cloud-create" action={addCloudPage}>
                <input type="hidden" name="parentId" value={id} />
                <label>{t('subpageTitle')} <input name="title" maxLength={160} required /></label>
                <Button type="submit" variant="secondary" size="sm" label={t('addSubpage')} />
              </form>
            </VStack>
          </Collapsible>
        )}
      </article>
    </main>
  )
}
