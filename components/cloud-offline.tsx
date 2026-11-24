'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { CloudOff, FileText } from 'lucide-react'
import { offlineAccount } from '@/lib/cloud/offline-account'
import { readOfflineCloudPage, readOfflineCloudPages } from '@/lib/cloud/local-search'
import { uuidPattern } from '@/lib/cloud/graph'
import { useTranslations } from '@/lib/i18n/client'
import CloudPageEditor from './cloud-page-editor'
import OfflineShell, { watchOfflineCookies, type OfflineCatalogs } from './offline-shell'

function browserAccount() {
  return offlineAccount(document.cookie)
}

const nothing = () => () => {}
const loading = () => undefined
const pageParam = () => new URLSearchParams(location.search).get('page')
const hrefFor = (id: string) => '/cloud-offline?' + new URLSearchParams({ page: id })

export default function CloudOffline({ catalogs }: { catalogs: OfflineCatalogs }) {
  return <OfflineShell catalogs={catalogs}><CloudOfflineScreen /></OfflineShell>
}

function CloudOfflineScreen() {
  const t = useTranslations('cloud-offline')
  const subject = useSyncExternalStore(watchOfflineCookies, browserAccount, loading)
  const id = useSyncExternalStore(nothing, pageParam, loading)
  return <main className="cloud-screen">
    <header className="account-header">
      <a href="/cloud-offline" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> {t('title')}</a>
      {id && uuidPattern.test(id)
        ? <a href={'/page/' + id} className="account-link">{t('openPage')}</a>
        : <a href="/cloud" className="account-link">{t('cloud')}</a>}
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
      offlineChoices={(pages ?? []).map(page => ({ id: page.id, title: page.title, path: page.title }))} />
  </article>

  return <section className="cloud-library">
    <span className="page-emblem"><CloudOff size={22} /></span>
    <h1>{t('title')}</h1>
    {failed ? <p role="alert">{t('readFailure')}</p>
      : id ? <p role="status">{expired ? t('accessExpired') : copy === null ? t('missingCopy') : t('loading')}</p>
      : pages?.length ? <ul className="cloud-pages">{pages.slice(0, visible).map(page => <li key={page.id}>
        <a href={hrefFor(page.id)}><FileText size={17} aria-hidden="true" /> {page.title}</a>
      </li>)}</ul> : <p role="status">{pages ? t('empty') : t('loading')}</p>}
    {!id && pages && pages.length > visible && <button type="button" className="secondary-button" onClick={() => setVisible(count => count + 60)}>{t('more')}</button>}
    {id && <a className="account-link" href="/cloud-offline">{t('browse')}</a>}
  </section>
}
