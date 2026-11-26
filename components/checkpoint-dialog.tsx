'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { checkpointInlineBytes, checkpointTransferBytes, replaceCheckpointContent, type Checkpoint } from '@/lib/cloud/checkpoints'
import { track } from '@/lib/analytics'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import type { CloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import { Dialog } from './workspace-dialogs'
import PageEditor from './page-editor'
import PublicPageBody from './public-page-body'

interface History {
  checkpoints: Checkpoint[]
  writable: boolean
  olderHistoryLimited: boolean
  retentionDays?: number
  canManageHistory?: boolean
}

interface Preview {
  record: Checkpoint
  replica: CloudCollaboration
  source: string | null
}

type CheckpointIssue = 'checkpointSizeLimit' | 'checkpointImageLimit' | 'checkpointPlanChanged'
  | 'checkpointSaveFailed' | 'checkpointOpenFailed' | 'checkpointContentFailed' | 'checkpointChangedDuringBackup'

class CheckpointError extends Error {
  constructor(readonly code: CheckpointIssue) { super(code) }
}

async function createCheckpoint(pageId: string, name: string, snapshot: Uint8Array, signal: AbortSignal) {
  if (snapshot.byteLength > checkpointTransferBytes) throw new CheckpointError('checkpointSizeLimit')
  const endpoint = '/api/checkpoints?' + new URLSearchParams({ pageId, name })
  const body = new Uint8Array(snapshot)
  const headers = { 'Content-Type': 'application/octet-stream' }
  const reply = snapshot.byteLength <= checkpointInlineBytes
    ? await fetch(endpoint, { method: 'POST', headers, body, signal })
    : await viaRelay(endpoint, { method: 'POST', headers, body, signal })
  const failure = reply && !reply.ok && (await reply.json().catch(() => null))?.error
  if (failure === 'checkpoint_image_limit') {
    throw new CheckpointError('checkpointImageLimit')
  }
  if (failure === 'checkpoint_plan_changed') throw new CheckpointError('checkpointPlanChanged')
  if (!reply?.ok) throw new CheckpointError('checkpointSaveFailed')
  const { checkpoint }: { checkpoint: Checkpoint } = await reply.json()
  return checkpoint
}

async function viaRelay(endpoint: string, options: RequestInit) {
  const { method, signal } = options
  const ticket = await fetch(endpoint + '&transport=relay', { method, signal, cache: 'no-store' })
  if (!ticket.ok) {
    if (ticket.status === 503 && (await ticket.clone().json().catch(() => null))?.error === 'checkpoint_transport_unavailable') return null
    return ticket
  }
  const transfer = await ticket.json()
  return fetch(transfer.endpoint, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + transfer.token },
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  })
}

export default function CheckpointDialog({ pageId, session, live, writable, onClose }: {
  pageId: string
  session: CloudCollaboration
  live: boolean
  writable: boolean
  onClose: () => void
}) {
  const locale = useLocale()
  const cloud = useTranslations('cloud-workspace')
  const t = useTranslations('cloud-dialogs')
  const [history, setHistory] = useState<History | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewFault, setPreviewFault] = useState<string | null>(null)
  const [message, setMessage] = useState<'checkpointSaved' | 'checkpointRestored' | null>(null)
  const [failure, setFailure] = useState<CheckpointIssue | 'checkpointsUnavailable' | 'checkpointTryAgain' | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const mayChange = live && writable && !!history?.writable
  const controller = useRef<AbortController | null>(null)
  const active = useRef({ session, live, writable })
  const reportedLimit = useRef(false)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  useEffect(() => { active.current = { session, live, writable } }, [session, live, writable])
  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    void fetch('/api/checkpoints?' + new URLSearchParams({ pageId }), { signal: abort.signal, cache: 'no-store' })
      .then(async reply => {
        if (!reply.ok) throw new Error('Could not load checkpoints.')
        const result: History = await reply.json()
        if (!abort.signal.aborted) {
          setHistory(result)
          if (result.olderHistoryLimited && !reportedLimit.current) reportedLimit.current = track('paywall_hit', 'history')
        }
      }).catch(() => {
        if (!abort.signal.aborted) setFailure('checkpointsUnavailable')
      })
    return () => { abort.abort() }
  }, [pageId, reload])

  useEffect(() => () => {
    preview?.replica.awareness.destroy()
    preview?.replica.document.destroy()
  }, [preview])

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal
    if (busy || !signal || signal.aborted) return
    setBusy(true)
    setFailure(null)
    setMessage(null)
    try {
      await task(signal)
    } catch (problem) {
      if (!signal.aborted) setFailure(problem instanceof CheckpointError ? problem.code : 'checkpointTryAgain')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  function addRecord(record: Checkpoint) {
    setHistory(current => current && { ...current, checkpoints: [record, ...current.checkpoints].slice(0, 50) })
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mayChange || !name.trim()) return
    void run(async signal => {
      const record = await createCheckpoint(pageId, name.trim(), Y.encodeStateAsUpdate(session.document), signal)
      if (signal.aborted) return
      addRecord(record)
      setName('')
      setMessage('checkpointSaved')
    })
  }

  function open(record: Checkpoint) {
    void run(async signal => {
      const endpoint = '/api/checkpoints?' + new URLSearchParams({ pageId, version: record.id })
      const relay = await viaRelay(endpoint, { method: 'GET', signal }).catch(problem => {
        if (signal.aborted || !(problem instanceof TypeError)) throw problem
        return null
      })
      const reply = relay ?? await fetch(endpoint, { signal, cache: 'no-store' })
      if (!reply.ok) throw new CheckpointError('checkpointOpenFailed')
      const data = await reply.arrayBuffer()
      if (signal.aborted) return
      const document = new Y.Doc()
      try {
        Y.applyUpdate(document, new Uint8Array(data))
        setPreview({
          record, replica: { document, awareness: new Awareness(document), subject: session.subject },
          source: document.getMap('lekhan').get('mode') === 'source' ? document.getText('source').toString() : null,
        })
      } catch {
        document.destroy()
        throw new CheckpointError('checkpointContentFailed')
      }
    })
  }

  function restore() {
    if (!mayChange || !preview || previewFault === preview.record.id) return
    void run(async signal => {
      let changed = false
      const track = () => { changed = true }
      const document = session.document
      const current = Y.encodeStateAsUpdate(document)
      document.on('update', track)
      try {
        const backupPrefixLength = t('backupName', { name: '' }).length
        const backupSource = preview.record.version_name.slice(0, Math.min(180, 200 - backupPrefixLength)).replace(/[\uD800-\uDBFF]$/u, '')
        const backup = await createCheckpoint(pageId, t('backupName', { name: backupSource }), current, signal)
        if (signal.aborted) return
        addRecord(backup)
        if (changed || active.current.session !== session || !active.current.live || !active.current.writable) {
          throw new CheckpointError('checkpointChangedDuringBackup')
        }
        replaceCheckpointContent(document, preview.replica.document, 'checkpoint-restore')
        setPreview(null)
        setMessage('checkpointRestored')
      } finally {
        document.off('update', track)
      }
    })
  }

  return <Dialog title={cloud('history')} className="form-dialog checkpoint-dialog" onClose={onClose}>
    <div className="checkpoint-header">
      <h2>{cloud('history')}</h2>
      <button className="icon-button" type="button" aria-label={t('closeHistory')} onClick={onClose}><X size={18} /></button>
    </div>
    {failure && <p className="account-error" role="alert">{t(failure)}</p>}
    {message && <p role="status">{t(message)}</p>}
    {!!history?.retentionDays && !preview && <p>
      {t('checkpointRetention', { days: history.retentionDays })}{history.olderHistoryLimited && history.canManageHistory &&
        <> <Link className="account-link" href="/billing">{t('compareHistory')}</Link></>}
    </p>}
    {mayChange && !preview && <form onSubmit={save} className="cloud-create">
      <label>{t('checkpointName')} <input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></label>
      <button className="primary-button" disabled={busy}>{t('saveCheckpoint')}</button>
    </form>}
    {!history ? failure
      ? <button className="secondary-button" onClick={() => { setFailure(null); setReload(value => value + 1) }}>{t('retry')}</button>
      : <p role="status">{t('loadingCheckpoints')}</p>
      : !preview && (history.checkpoints.length ? <ul className="checkpoint-list">
        {history.checkpoints.map(record => <li key={record.id}>
          <button className="search-result" type="button" disabled={busy} onClick={() => open(record)}>
            <span><strong>{record.version_name}</strong><small>{date.format(new Date(record.created_at))}</small></span>
          </button>
        </li>)}
      </ul> : <p>{history.olderHistoryLimited ? t('checkpointsOutsideWindow') : t('noCheckpoints')}</p>)}
    {preview && <section aria-label={t('checkpointPreview')} className="checkpoint-preview">
      <h3>{preview.record.version_name}</h3>
      {previewFault === preview.record.id && <p role="alert">{t('checkpointUnsupported')}</p>}
      {preview.source !== null ? <PublicPageBody source={preview.source} targets={new Map()} /> : <PageEditor
        key={preview.record.id} pageId={preview.record.id} collaboration={preview.replica}
        editable={false} showModePicker={false} choices={[]} markdown="" onChange={() => {}} onOpenLink={() => {}}
        onSchemaError={() => setPreviewFault(preview.record.id)}
      />}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>{t('backToHistory')}</button>
        {mayChange && <button type="button" className="primary-button" disabled={busy || previewFault === preview.record.id} onClick={restore}>{t('restoreWithBackup')}</button>}
      </div>
    </section>}
  </Dialog>
}
