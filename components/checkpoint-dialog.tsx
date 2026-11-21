'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { checkpointMaxBytes, replaceCheckpointContent, type Checkpoint } from '@/lib/cloud/checkpoints'
import { useLocale } from '@/lib/i18n/client'
import type { CloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import { Dialog } from './workspace-dialogs'
import PageEditor from './page-editor'

interface History {
  checkpoints: Checkpoint[]
  writable: boolean
}

interface Preview {
  record: Checkpoint
  replica: CloudCollaboration
  source: string | null
}

async function createCheckpoint(pageId: string, name: string, snapshot: Uint8Array, signal: AbortSignal) {
  if (snapshot.byteLength > checkpointMaxBytes) throw new Error('This page exceeds the checkpoint size limit.')
  const endpoint = '/api/checkpoints?' + new URLSearchParams({ pageId, name })
  const reply = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(snapshot), signal,
  })
  if (!reply.ok) throw new Error('Could not save the checkpoint.')
  const { checkpoint }: { checkpoint: Checkpoint } = await reply.json()
  return checkpoint
}

export default function CheckpointDialog({ pageId, session, live, writable, onClose }: {
  pageId: string
  session: CloudCollaboration
  live: boolean
  writable: boolean
  onClose: () => void
}) {
  const locale = useLocale()
  const [history, setHistory] = useState<History | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewFault, setPreviewFault] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const mayChange = live && writable && !!history?.writable
  const controller = useRef<AbortController | null>(null)
  const active = useRef({ session, live, writable })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  useEffect(() => { active.current = { session, live, writable } }, [session, live, writable])
  useEffect(() => {
    const abort = new AbortController()
    controller.current = abort
    void fetch('/api/checkpoints?' + new URLSearchParams({ pageId }), { signal: abort.signal, cache: 'no-store' })
      .then(async reply => {
        if (!reply.ok) throw new Error('Could not load checkpoints.')
        const result: History = await reply.json()
        if (!abort.signal.aborted) setHistory(result)
      }).catch(() => {
        if (!abort.signal.aborted) setFailure('Could not load checkpoints.')
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
    setFailure('')
    setMessage('')
    try {
      await task(signal)
    } catch (problem) {
      if (!signal.aborted) setFailure(problem instanceof Error ? problem.message : 'Checkpoints are temporarily unavailable.')
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
      setMessage('Checkpoint saved.')
    })
  }

  function open(record: Checkpoint) {
    void run(async signal => {
      const reply = await fetch('/api/checkpoints?' + new URLSearchParams({ pageId, version: record.id }), { signal, cache: 'no-store' })
      if (!reply.ok) throw new Error('Could not open this checkpoint.')
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
        throw new Error('Could not load this checkpoint’s content.')
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
        const backup = await createCheckpoint(pageId, 'Before restoring ' + preview.record.version_name.slice(0, 180), current, signal)
        if (signal.aborted) return
        addRecord(backup)
        if (changed || active.current.session !== session || !active.current.live || !active.current.writable) {
          throw new Error('The page or your access changed while making the backup. Review the current page before retrying.')
        }
        replaceCheckpointContent(document, preview.replica.document, 'checkpoint-restore')
        setPreview(null)
        setMessage('Checkpoint restored. The previous content is available in history.')
      } finally {
        document.off('update', track)
      }
    })
  }

  return <Dialog title="Version history" className="form-dialog checkpoint-dialog" onClose={onClose}>
    <div className="checkpoint-header">
      <h2>Version history</h2>
      <button className="icon-button" type="button" aria-label="Close version history" onClick={onClose}><X size={18} /></button>
    </div>
    {failure && <p className="account-error" role="alert">{failure}</p>}
    {message && <p role="status">{message}</p>}
    {mayChange && !preview && <form onSubmit={save} className="cloud-create">
      <label>Checkpoint name <input value={name} onChange={event => setName(event.target.value)} maxLength={200} required /></label>
      <button className="primary-button" disabled={busy}>Save checkpoint</button>
    </form>}
    {!history ? failure
      ? <button className="secondary-button" onClick={() => { setFailure(''); setReload(value => value + 1) }}>Retry</button>
      : <p role="status">Loading checkpoints…</p>
      : !preview && (history.checkpoints.length ? <ul className="checkpoint-list">
        {history.checkpoints.map(record => <li key={record.id}>
          <button className="search-result" type="button" disabled={busy} onClick={() => open(record)}>
            <span><strong>{record.version_name}</strong><small>{date.format(new Date(record.created_at))}</small></span>
          </button>
        </li>)}
      </ul> : <p>No checkpoints yet.</p>)}
    {preview && <section aria-label="Checkpoint preview" className="checkpoint-preview">
      <h3>{preview.record.version_name}</h3>
      {previewFault === preview.record.id && <p role="alert">This checkpoint contains unsupported blocks. Restore is unavailable.</p>}
      {preview.source !== null ? <pre>{preview.source}</pre> : <PageEditor
        key={preview.record.id} pageId={preview.record.id} collaboration={preview.replica}
        editable={false} choices={[]} markdown="" onChange={() => {}} onOpenLink={() => {}}
        onSchemaError={() => setPreviewFault(preview.record.id)}
      />}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>Back to history</button>
        {mayChange && <button type="button" className="primary-button" disabled={busy || previewFault === preview.record.id} onClick={restore}>Restore and keep a backup</button>}
      </div>
    </section>}
  </Dialog>
}
