'use client'

import { type MouseEvent, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { CloudOff, FileText } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { offlineAccount } from '@/lib/cloud/offline-account'
import { bootstrapTierGates } from '@/lib/analytics'
import { readOfflineCloudPage, readOfflineCloudPages } from '@/lib/cloud/local-search'
import { uuidPattern } from '@/lib/cloud/graph'
import { useTranslations } from '@/lib/i18n/client'
import CloudPageEditor from './cloud-page-editor'
import CloudSearch from './cloud-search'
import OfflineShell, { watchOfflineCookies, type OfflineCatalogs } from './offline-shell'

function browserAccount() {
  return offlineAccount(document.cookie)
}

const navEvent = 'lekhan:cloud-offline-nav'
const loading = () => undefined
const pageParam = () => new URLSearchParams(location.search).get('page')
const hrefFor = (id: string | null) => id ? '/cloud-offline?' + new URLSearchParams({ page: id }) : '/cloud-offline'

function watchNavigation(check: () => void) {
  window.addEventListener('popstate', check)
  window.addEventListener(navEvent, check)
  return () => {
    window.removeEventListener('popstate', check)
    window.removeEventListener(navEvent, check)
  }
}

function openOfflinePage(id: string | null, fragment = '') {
  const next = new URL(hrefFor(id), window.location.origin)
  if (fragment) next.hash = fragment.startsWith('#') ? fragment : '#' + fragment
  const current = window.location.pathname + window.location.search + window.location.hash
  const target = next.pathname + next.search + next.hash
  if (current !== target) {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new Event(navEvent))
  }
  if (next.hash) window.dispatchEvent(new Event('hashchange'))
}

function handleOfflineNav(id: string | null) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openOfflinePage(id)
  }
}

export default function CloudOffline({ catalogs }: { catalogs: OfflineCatalogs }) {
  return <OfflineShell catalogs={catalogs}><CloudOfflineScreen /></OfflineShell>
}

function CloudOfflineScreen() {
  const t = useTranslations('cloud-offline')
  const subject = useSyncExternalStore(watchOfflineCookies, browserAccount, loading)
  const id = useSyncExternalStore(watchNavigation, pageParam, loading)
  useEffect(() => {
    if (subject !== undefined) bootstrapTierGates(subject ? 'account:' + subject : 'personal', subject ? undefined : null)
  }, [subject])
  return <main className="cloud-screen">
    <header className="account-header">
      <a href="/cloud-offline" className="account-brand" onClick={handleOfflineNav(null)}>
        <span className="brand-mark" aria-hidden="true">L</span> {t('title')}
      </a>
      <div className="cloud-header-actions">
        <a href="/workspace-offline" className="account-link">{t('notebook')}</a>
        {subject && <CloudSearch subject={subject} offline onOpen={target => openOfflinePage(target)} />}
        {id && uuidPattern.test(id)
          ? <a href={'/page/' + id} className="account-link">{t('openPage')}</a>
          : <a href="/cloud" className="account-link">{t('cloud')}</a>}
      </div>
    </header>
    {subject && id !== undefined ? <OfflineCopies key={subject + ':' + id} subject={subject} id={id} />
      : <section className="cloud-library">
        <h1>{t('title')}</h1>
        <p role="status">{subject === undefined ? t('loading') : t('signedOut')}</p>
      </section>}
  </main>
}

type Copy = NonNullable<Awaited<ReturnType<typeof readOfflineCloudPage>>>

function OfflineCopies({ subject, id }: { subject: string; id: string | null }) {
  const t = useTranslations('cloud-offline')
  const [copy, setCopy] = useState<Copy | null | undefined>()
  const [pages, setPages] = useState<Copy[]>()
  const [failed, setFailed] = useState(false)
  const [expired, setExpired] = useState(false)
  const dropCopy = useCallback(() => {
    setCopy(null)
    setExpired(true)
  }, [])
  const [visible, setVisible] = useState(60)

  useEffect(() => {
    let current = true
    if (id) {
      void (uuidPattern.test(id) ? readOfflineCloudPage(subject, id) : Promise.resolve(null))
        .then(result => { if (current) setCopy(result) })
        .catch(() => { if (current) setFailed(true) })
    }
    void readOfflineCloudPages(subject).then(result => { if (current) setPages(result) })
      .catch(() => { if (current && !id) setFailed(true) })
    return () => { current = false }
  }, [id, subject])

  if (copy) return <article className="cloud-library">
    <h1>{copy.title}</h1>
    <CloudPageEditor page={{
      id: copy.id, workspace_id: '', owner_id: '', parent_id: null, title: copy.title,
      is_public: false, properties: copy.properties ?? null, updated_at: copy.updatedAt,
    }} subject={subject} role={copy.role ?? 'editor'} enabled onAccessLost={dropCopy}
      onOpenOfflinePage={(target, fragment) => openOfflinePage(target, fragment)}
      offlineChoices={(pages ?? []).map(page => ({ id: page.id, title: page.title, path: page.title }))} />
  </article>

  return <section className="cloud-library">
    <span className="page-emblem"><CloudOff size={22} /></span>
    <h1>{t('title')}</h1>
    {failed ? <p role="alert">{t('readFailure')}</p>
      : id ? <p role="status">{expired ? t('accessExpired') : copy === null ? t('missingCopy') : t('loading')}</p>
      : pages?.length ? <ul className="cloud-pages">{pages.slice(0, visible).map(page => <li key={page.id}>
        <a href={hrefFor(page.id)} onClick={handleOfflineNav(page.id)}><FileText size={17} aria-hidden="true" /> {page.title}</a>
      </li>)}</ul> : <p role="status">{pages ? t('empty') : t('loading')}</p>}
    {!id && pages && pages.length > visible && (
      <Button type="button" variant="secondary" label={t('more')} onClick={() => setVisible(count => count + 60)} />
    )}
    {id && <a className="account-link" href="/cloud-offline" onClick={handleOfflineNav(null)}>{t('browse')}</a>}
  </section>
}
