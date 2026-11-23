'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Paperclip, Trash2, X } from 'lucide-react'
import { attachmentName, type CloudAttachment } from '@/lib/cloud/attachments'
import { Dialog } from './workspace-dialogs'

interface FileList { files: CloudAttachment[]; after: string | null; writable: boolean; canRemove: boolean; maxBytes: number }

function formatBytes(bytes: number) {
  return bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB`
    : `${Number((bytes / 1_000_000).toFixed(1))} MB`
}

async function transfer(pageId: string, id: string, options: RequestInit) {
  const session = await fetch('/api/sync/session?' + new URLSearchParams({ pageId }), { cache: 'no-store', signal: options.signal })
  if (!session.ok) throw new Error('Could not verify access to this page.')
  const { endpoint, ticket } = await session.json()
  const url = new URL(endpoint)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = `/attachments/${pageId}/${id}`
  const reply = await fetch(url, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + ticket }, credentials: 'omit',
    cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
  })
  if (reply.ok) return reply
  const body = await reply.json().catch(() => null)
  if (body?.error === 'workspace_limit') throw new Error('This workspace has reached its file storage limit.')
  if (body?.error === 'file_limit') throw new Error('This file exceeds the workspace’s current per-file limit.')
  if (reply.status === 403 || reply.status === 404) throw new Error('Access to this file or page changed.')
  throw new Error('The file transfer could not finish. Try again.')
}

export default function CloudAttachments({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [list, setList] = useState<FileList | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [pendingRemoval, setPendingRemoval] = useState<CloudAttachment | null>(null)
  const aborter = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    aborter.current = controller
    void loadFiles(pageId, controller.signal).then(data => {
      if (!controller.signal.aborted) setList(data)
    }).catch(() => { if (!controller.signal.aborted) setError('Could not load attachments.') })
    return () => controller.abort()
  }, [pageId, reload])

  async function act(label: string, job: (signal: AbortSignal) => Promise<void>) {
    const signal = aborter.current?.signal
    if (busy || !signal || signal.aborted) return
    setBusy(label)
    setError('')
    setMessage('')
    try { await job(signal) }
    catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'The transfer could not finish.') }
    finally { if (!signal.aborted) setBusy('') }
  }

  function pick(file: File) {
    if (!list?.writable || busy) return
    const name = attachmentName(file.name)
    if (!name || !file.size) { setError('Choose a non-empty file with a valid name.'); return }
    if (file.size > list.maxBytes) { setError(`Choose a file up to ${formatBytes(list.maxBytes)}.`); return }
    void act(`Uploading ${name}…`, async signal => {
      const reply = await transfer(pageId, crypto.randomUUID(), { method: 'POST', signal, body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Lekhan-Filename': encodeURIComponent(name), 'X-Lekhan-Bytes': String(file.size) } })
      const item: CloudAttachment = await reply.json()
      setList(current => current && { ...current, files: [item, ...current.files] })
      setMessage(`Attached ${item.filename}.`)
    })
  }

  function download(file: CloudAttachment) {
    void act(`Downloading ${file.filename}…`, async signal => {
      const reply = await transfer(pageId, file.id, { method: 'GET', signal })
      const bytes = await reply.blob()
      if (signal.aborted) return
      const url = URL.createObjectURL(bytes)
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    })
  }

  function remove(file: CloudAttachment) {
    void act(`Removing ${file.filename}…`, async signal => {
      const reply = await fetch('/api/attachments?' + new URLSearchParams({ pageId, id: file.id }), { method: 'DELETE', signal })
      if (!reply.ok) throw new Error('Could not remove this attachment.')
      setList(current => current && { ...current, files: current.files.filter(item => item.id !== file.id) })
      setPendingRemoval(null)
      setMessage(`Removed ${file.filename}.`)
    })
  }

  return <Dialog title="Attachments" className="form-dialog checkpoint-dialog" onClose={onClose}>
    <div className="checkpoint-header">
      <h2>Attachments</h2>
      <button type="button" className="icon-button" aria-label="Close attachments" onClick={onClose}><X size={18} /></button>
    </div>
    {error && <p role="alert" className="account-error">{error}</p>}
    {(busy || message) && <p role="status">{busy || message}</p>}
    {!list && (error ? <button className="secondary-button" onClick={() => { setError(''); setReload(value => value + 1) }}>Retry</button>
      : <p role="status">Loading attachments…</p>)}
    {list?.writable && <div className="attachment-picker">
      <label className="secondary-button"><Paperclip size={16} /> Attach a file
        <input type="file" aria-label="Attach a file" disabled={!!busy} onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) pick(file)
        }} />
      </label>
      <span>Up to {formatBytes(list.maxBytes)} per file</span>
    </div>}
    {list && (!list.files.length ? <p>No attachments yet.</p> : <ul className="checkpoint-list attachment-list">
      {list.files.map(file => <li key={file.id} className="attachment-row">
        <button type="button" className="search-result" disabled={!!busy} onClick={() => download(file)} aria-label={`Download ${file.filename}`}>
          <FileText size={17} aria-hidden="true" /><span><strong>{file.filename}</strong><small>{formatBytes(file.byte_count)}</small></span>
          <Download size={16} aria-hidden="true" />
        </button>
        {list.canRemove && <button type="button" className="icon-button" disabled={!!busy} title={`Remove ${file.filename}`}
          aria-label={`Remove ${file.filename}`} onClick={() => setPendingRemoval(file)}><Trash2 size={16} /></button>}
      </li>)}
    </ul>)}
    {pendingRemoval && <div className="billing-notice">
      <p>Remove {pendingRemoval.filename} from this page?</p>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => setPendingRemoval(null)}>Cancel</button>
        <button type="button" className="primary-button" disabled={!!busy} onClick={() => remove(pendingRemoval)}>Remove file</button>
      </div>
    </div>}
    {list?.after && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => {
      const after = list.after
      void act('Loading more files…', async signal => {
        const next = await loadFiles(pageId, signal, after)
        setList(current => current && { ...next, files: Array.from(new Map([...current.files, ...next.files].map(file => [file.id, file])).values()) })
      })
    }}>Load more</button>}
  </Dialog>
}

async function loadFiles(pageId: string, signal: AbortSignal, after?: string | null): Promise<FileList> {
  const params = new URLSearchParams({ pageId })
  if (after) params.set('after', after)
  const reply = await fetch('/api/attachments?' + params, { signal, cache: 'no-store' })
  if (!reply.ok) throw new Error('Could not load attachments.')
  return reply.json()
}
