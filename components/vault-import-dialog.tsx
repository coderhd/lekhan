'use client'

import { AlertCircle, Archive, Check, FolderOpen, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Dialog } from './workspace-dialogs'
import type { ImportReport, VaultImportPlan } from '@/lib/vault-import'
import type { SaveStatus } from '@/lib/use-workspace'
import { pickVaultFolder, readVaultFiles, readVaultZip, type VaultContents } from '@/lib/vault-reader'

export function VaultImportDialog({ onClose, onImport, saveStatus }: {
  onClose: () => void
  onImport: (plan: VaultImportPlan) => ImportReport | null
  saveStatus: SaveStatus
}) {
  const zip = useRef<HTMLInputElement>(null)
  const directory = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)

  async function run(read: () => Promise<VaultContents | null>) {
    if (busy.current) return
    busy.current = true
    setReading(true)
    setError('')
    setReport(null)
    try {
      const contents = await read()
      if (!contents) return
      const { planVaultImport } = await import('@/lib/vault-import')
      const result = onImport(await planVaultImport(contents))
      if (!result) throw new Error('The workspace is still opening. Try again when it is ready.')
      setReport(result)
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        setError(failure instanceof Error ? failure.message : 'The vault could not be read.')
      }
    } finally {
      busy.current = false
      setReading(false)
    }
  }

  function selectZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void run(() => readVaultZip(file))
  }

  function selectFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length) void run(() => readVaultFiles(files))
  }

  const saved = report && saveStatus === 'saved'
  const saveFailed = report && (saveStatus === 'error' || saveStatus === 'conflict')

  return (
    <Dialog title="Import an Obsidian vault" onClose={() => { if (!busy.current) onClose() }}>
      <div className="form-dialog vault-dialog">
        <h2>Import an Obsidian vault</h2>
        <p>Choose a ZIP archive or vault folder. Lekhan keeps your note hierarchy, properties, and page links.</p>
        <input ref={zip} type="file" accept=".zip,application/zip" hidden aria-label="Vault ZIP" onChange={selectZip} />
        <input ref={directory} type="file" {...{ webkitdirectory: "" }} multiple hidden aria-label="Vault folder" onChange={selectFolder} />
        {!report && <div className="vault-options">
          <button className="secondary-button" disabled={reading} onClick={() => zip.current?.click()}><Archive size={17} /> Choose ZIP</button>
          <button className="secondary-button" disabled={reading} onClick={() => {
            if (!('showDirectoryPicker' in window) || !window.isSecureContext) {
              directory.current?.click()
            } else {
              void run(pickVaultFolder)
            }
          }}><FolderOpen size={17} /> Choose folder</button>
        </div>}
        {reading && <div role="status" className="vault-status"><LoaderCircle size={16} className="spin" /> Reading vault…</div>}
        {error && <div role="alert" className="vault-status vault-error"><AlertCircle size={16} /> {error}</div>}
        {report && <>
          <div role="status" className="vault-status">
            {saved ? <Check size={16} /> : saveFailed ? <AlertCircle size={16} /> : <LoaderCircle size={16} className="spin" />}
            {saved ? report.repeated ? 'Vault already imported' : 'Import saved locally' : saveFailed ? 'Import is open but could not be saved' : 'Saving imported pages…'}
          </div>
          <dl className="vault-report">
            {[
              ['Notes', report.notes], ['Folders', report.folders], ['Images', report.images],
              ['Resolved links', report.resolved], ['Unresolved links', report.unresolved],
              ['Converted embeds', report.degraded],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {report.degraded > 0 && <p>Attachments Lekhan couldn’t display were kept as links.</p>}
          {report.invalidProperties > 0 && <p>Some properties could not be read. Their original YAML is still in the page source.</p>}
        </>}
        <div className="dialog-actions">
          <button className={saved ? 'primary-button' : 'secondary-button'} onClick={onClose} disabled={reading}>
            {report ? 'Open workspace' : 'Cancel'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
