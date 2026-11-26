'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Paperclip, Trash2, X } from 'lucide-react'
import { attachmentName, type CloudAttachment } from '@/lib/cloud/attachments'
import { AttachmentTransferError, listCloudAttachments, transferCloudAttachment, type CloudAttachmentList } from '@/lib/cloud/attachment-client'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { downloadBlob } from '@/lib/downloads'
import { Dialog } from './workspace-dialogs'

function formatBytes(bytes: number, locale: string) {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: bytes < 1_000_000 ? 0 : 1 })
  if (bytes < 1000) return format.format(bytes) + ' B'
  if (bytes < 1_000_000) return format.format(bytes / 1000) + ' KB'
  return format.format(bytes / 1_000_000) + ' MB'
}

export default function CloudAttachments({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const locale = useLocale()
  const t = useTranslations('cloud-dialogs')
  const cloud = useTranslations('cloud-workspace')
  const [list, setList] = useState<CloudAttachmentList | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [pendingRemoval, setPendingRemoval] = useState<CloudAttachment | null>(null)
  const aborter = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    aborter.current = controller
    void listCloudAttachments(pageId, controller.signal).then(data => {
      if (!controller.signal.aborted) setList(data)
    }).catch(() => { if (!controller.signal.aborted) setError(t('attachmentsUnavailable')) })
    return () => controller.abort()
  }, [pageId, reload, t])

  async function act(label: string, job: (signal: AbortSignal) => Promise<void>, fallback: 'transferFailed' | 'attachmentRemoveFailed' = 'transferFailed') {
    const signal = aborter.current?.signal
    if (busy || !signal || signal.aborted) return
    setBusy(label)
    setError(null)
    setMessage('')
    try { await job(signal) }
    catch (failure) { if (!signal.aborted) setError(t(failure instanceof AttachmentTransferError ? failure.code : fallback)) }
    finally { if (!signal.aborted) setBusy('') }
  }

  function pick(file: File) {
    if (!list?.writable || busy) return
    const name = attachmentName(file.name)
    if (!name || !file.size) { setError(t('invalidFile')); return }
    if (file.size > list.maxBytes) { setError(t('fileTooLarge', { size: formatBytes(list.maxBytes, locale) })); return }
    void act(t('uploadingFile', { name }), async signal => {
      const reply = await transferCloudAttachment(pageId, crypto.randomUUID(), { method: 'POST', signal, body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Lekhan-Filename': encodeURIComponent(name), 'X-Lekhan-Bytes': String(file.size) } })
      const item: CloudAttachment = await reply.json()
      setList(current => current && { ...current, files: [item, ...current.files] })
      setMessage(t('fileAttached', { name: item.filename }))
    })
  }

  function download(file: CloudAttachment) {
    void act(t('downloadingFile', { name: file.filename }), async signal => {
      const reply = await transferCloudAttachment(pageId, file.id, { method: 'GET', signal })
      const bytes = await reply.blob()
      if (signal.aborted) return
      downloadBlob(file.filename, bytes)
    })
  }

  function remove(file: CloudAttachment) {
    void act(t('removingFile', { name: file.filename }), async signal => {
      const reply = await fetch('/api/attachments?' + new URLSearchParams({ pageId, id: file.id }), { method: 'DELETE', signal })
      if (!reply.ok) throw new Error('Attachment removal failed.')
      setList(current => current && { ...current, files: current.files.filter(item => item.id !== file.id) })
      setPendingRemoval(null)
      setMessage(t('fileRemoved', { name: file.filename }))
    }, 'attachmentRemoveFailed')
  }

  return <Dialog title={cloud('attachments')} className="form-dialog checkpoint-dialog" onClose={onClose}>
    <div className="checkpoint-header">
      <h2>{cloud('attachments')}</h2>
      <button type="button" className="icon-button" aria-label={t('closeAttachments')} onClick={onClose}><X size={18} /></button>
    </div>
    {error && <p role="alert" className="account-error">{error}</p>}
    {(busy || message) && <p role="status">{busy || message}</p>}
    {!list && (error ? <button className="secondary-button" onClick={() => { setError(null); setReload(value => value + 1) }}>{t('retry')}</button>
      : <p role="status">{t('loadingAttachments')}</p>)}
    {list?.writable && <div className="attachment-picker">
      <label className="secondary-button"><Paperclip size={16} /> {t('attachFile')}
        <input type="file" aria-label={t('attachFile')} disabled={!!busy} onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) pick(file)
        }} />
      </label>
      <span>{t('maxFileSize', { size: formatBytes(list.maxBytes, locale) })}</span>
    </div>}
    {list && (!list.files.length ? <p>{t('noAttachments')}</p> : <ul className="checkpoint-list attachment-list">
      {list.files.map(file => <li key={file.id} className="attachment-row">
        <button type="button" className="search-result" disabled={!!busy} onClick={() => download(file)} aria-label={t('downloadFile', { name: file.filename })}>
          <FileText size={17} aria-hidden="true" /><span><strong>{file.filename}</strong><small>{formatBytes(file.byte_count, locale)}</small></span>
          <Download size={16} aria-hidden="true" />
        </button>
        {list.canRemove && <button type="button" className="icon-button" disabled={!!busy} title={t('removeFileLabel', { name: file.filename })}
          aria-label={t('removeFileLabel', { name: file.filename })} onClick={() => setPendingRemoval(file)}><Trash2 size={16} /></button>}
      </li>)}
    </ul>)}
    {pendingRemoval && <div className="billing-notice">
      <p>{t('confirmRemoveFile', { name: pendingRemoval.filename })}</p>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => setPendingRemoval(null)}>{t('cancel')}</button>
        <button type="button" className="primary-button" disabled={!!busy} onClick={() => remove(pendingRemoval)}>{t('removeFile')}</button>
      </div>
    </div>}
    {list?.after && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => {
      const after = list.after
      void act(t('loadingMoreFiles'), async signal => {
        const next = await listCloudAttachments(pageId, signal, after)
        setList(current => current && { ...next, files: Array.from(new Map([...current.files, ...next.files].map(file => [file.id, file])).values()) })
      })
    }}>{t('loadMore')}</button>}
  </Dialog>
}
