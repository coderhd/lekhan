'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileArchive, X } from 'lucide-react'
import { Dialog } from './workspace-dialogs'
import { downloadBlob, downloadPage } from '@/lib/downloads'
import { safeFilename } from '@/lib/workspace-export'
import { writeCloudPageArchive, type CloudExportProgress } from '@/lib/cloud/page-export'
import { track } from '@/lib/analytics'
import { useTranslations } from '@/lib/i18n/client'
import type { Page } from '@/lib/types'

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

export default function CloudExportDialog({ page, onClose, markdownOnly }: { page: Page; onClose: () => void; markdownOnly?: boolean }) {
  const t = useTranslations('cloud-export')
  const operation = useRef<AbortController | null>(null)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<CloudExportProgress | null>(null)
  const [failure, setFailure] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => () => operation.current?.abort(), [])

  function close() {
    operation.current?.abort()
    onClose()
  }

  async function exportZip() {
    if (operation.current) return
    const abort = new AbortController()
    operation.current = abort
    setWorking(true)
    setProgress(null)
    setFailure(false)
    setComplete(false)
    const filename = safeFilename(page.title) + '.zip'
    try {
      const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
      const handle = await picker?.call(window, {
        suggestedName: filename, types: [{ description: t('zipFile'), accept: { 'application/zip': ['.zip'] } }],
      }).catch(error => {
        if (error instanceof DOMException && ['SecurityError', 'NotSupportedError'].includes(error.name)) return undefined
        throw error
      })
      abort.signal.throwIfAborted()
      if (handle) {
        const output = await handle.createWritable()
        await writeCloudPageArchive(page, output, abort.signal, setProgress)
      } else {
        const output = new TransformStream<Uint8Array<ArrayBuffer>>()
        const [blob] = await Promise.all([
          new Response(output.readable, { headers: { 'Content-Type': 'application/zip' } }).blob(),
          writeCloudPageArchive(page, output.writable, abort.signal, setProgress),
        ])
        abort.signal.throwIfAborted()
        downloadBlob(filename, blob)
      }
      track('export_triggered', 'md_zip')
      setComplete(true)
    } catch (error) {
      if (!abort.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setFailure(true)
    } finally {
      operation.current = null
      if (!abort.signal.aborted) setWorking(false)
    }
  }

  return <Dialog title={t('title')} className="form-dialog checkpoint-dialog" onClose={close}>
    <div className="checkpoint-header">
      <h2>{t('title')}</h2>
      <button className="icon-button" type="button" onClick={close} aria-label={t('close')}><X size={18} /></button>
    </div>
    <p>{page.title}</p>
    <div className="cloud-export-options">
      <div>
        <button type="button" className="secondary-button" onClick={() => { downloadPage(page); onClose() }} disabled={working}>
          <Download size={16} aria-hidden="true" /> {t('markdown')}
        </button>
        <p>{t('markdownDescription')}</p>
      </div>
      {!markdownOnly && <div>
        <button type="button" className="primary-button" onClick={() => void exportZip()} disabled={working}>
          <FileArchive size={16} aria-hidden="true" /> {t('zip')}
        </button>
        <p>{t('zipDescription')}</p>
      </div>}
    </div>
    {working && <p role="status">{progress && progress.total > 0
      ? t('progress', { completed: progress.completed, total: progress.total }) : t('preparing')}</p>}
    {failure && <p role="alert" className="account-error">{t('failed')}</p>}
    {complete && <p role="status">{t('complete')}</p>}
    {working && <div className="dialog-actions"><button className="secondary-button" type="button" onClick={close}>{t('cancel')}</button></div>}
  </Dialog>
}
