'use client'

import { AlertCircle, Archive, Check, FileText, FolderOpen, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Dialog } from './workspace-dialogs'
import { planVaultImport, type ImportReport, type VaultImportPlan } from '@/lib/vault-import'
import type { SaveStatus } from '@/lib/use-workspace'
import { pickVaultFolder, readVaultFiles, readVaultZip, type VaultContents } from '@/lib/vault-reader'
import { uploadImportedAttachment } from '@/lib/cloud/attachment-client'
import type { cloudImportPlan, CloudImportReceipt } from '@/lib/cloud/import-plan'
import type { CloudImportImageContext } from '@/lib/cloud/prepare-images'
import { consumeAnalyticsReceipts, track } from '@/lib/analytics'

type Destination = { cloud: true; onOpenPage: (id: string) => void }
  | { cloud?: false; onImport: (plan: VaultImportPlan) => ImportReport | null; includeAttachments?: boolean; saveStatus: SaveStatus }

export function VaultImportDialog(props: Destination & { onClose: () => void }) {
  const { onClose } = props
  const includeAttachments = props.cloud || props.includeAttachments === true
  const zip = useRef<HTMLInputElement>(null)
  const directory = useRef<HTMLInputElement>(null)
  const markdown = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [draft, setDraft] = useState<(ReturnType<typeof cloudImportPlan> & { account?: string }) | null>(null)
  const [reading, setReading] = useState<'vault' | 'cloud' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ saved: number; resumed: number; total: number; files: number; filesTotal: number } | null>(null)
  const [firstPage, setFirstPage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [optimizedImages, setOptimizedImages] = useState(0)
  const source = useRef<'obsidian' | 'markdown'>('obsidian')

  useEffect(() => {
    if (report) track('import_report_viewed', source.current, report.degraded)
  }, [report])

  async function upload(plan: ReturnType<typeof cloudImportPlan> & { account?: string }) {
    setUploading(true)
    setError('')
    const total = plan.report.notes + plan.report.folders
    let saved = 0
    let resumed = 0
    let files = 0
    let reusedFiles = 0
    const updateProgress = () => setProgress({ saved, resumed, total, files, filesTotal: plan.files.length })
    updateProgress()
    try {
      for (const batch of plan.batches) {
        const result = await fetch('/api/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(plan.account ? { 'X-Lekhan-Account': plan.account } : {}) },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(120_000),
        })
        if (result.status === 413 || result.status === 409) {
          const detail = await result.json().catch(() => null)
          if (detail?.error === 'import_free_image_limit') throw new Error('Free cloud imports use WebP images up to 500 KB and 1,600 pixels per side.')
          if (detail?.error === 'import_paid_image_limit') throw new Error('A cloud image exceeds the 20 MB limit.')
          if (detail?.error === 'import_workspace_media_limit') throw new Error('These images would exceed the workspace’s storage limit. Free up space and resume the import.')
          if (detail?.error === 'import_image_policy_changed') {
            setDraft(null)
            throw new Error('The workspace image limits changed. Choose the original files again to resume.')
          }
        }
        if (result.status === 413) throw new Error('The cloud host rejected the size of this batch. Earlier batches are still saved.')
        if (result.status === 403) throw new Error('Sign back into the account that started this import.')
        if (result.status === 400) throw new Error('A note has a title, path, or property that the cloud workspace could not accept.')
        if (result.status === 409) throw new Error('This batch conflicts with a saved import. Select the original files to continue.')
        if (!result.ok) throw new Error('Could not finish the cloud upload. Resume to continue from the saved batches.')
        const receipt: CloudImportReceipt = await result.json()
        consumeAnalyticsReceipts()
        const firstIndex = batch.pages.findIndex(page => page.ordinal === plan.firstNote)
        if (firstIndex >= 0 && receipt.pages[firstIndex]) setFirstPage(receipt.pages[firstIndex].id)
        saved += receipt.importedCount
        if (receipt.replayed) resumed += receipt.importedCount
        updateProgress()
        const targets = new Map(batch.pages.map((page, index) => [page.ordinal, receipt.pages[index]?.id]))
        for (const file of plan.files) {
          if (!targets.has(file.ordinal)) continue
          const target = targets.get(file.ordinal)
          if (!target) throw new Error('An attachment could not be matched to its imported page.')
          const replayed = await uploadImportedAttachment(target, file, plan.account)
          files++
          if (replayed) reusedFiles++
          updateProgress()
        }
      }
      if (files !== plan.files.length) throw new Error('Some files could not be matched to their imported pages.')
      setReport({ ...plan.report, ...(files ? { files } : {}), repeated: saved === resumed && files === reusedFiles })
      if (saved > resumed || files > reusedFiles) track('import_completed', source.current, plan.report.notes)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not finish the cloud upload.')
    } finally {
      setUploading(false)
    }
  }

  function resume() {
    const plan = draft
    if (busy.current || !plan) return
    busy.current = true
    void upload(plan).finally(() => { busy.current = false })
  }

  async function run(read: () => Promise<VaultContents | null>, format: 'obsidian' | 'markdown' = 'obsidian') {
    if (busy.current) return
    busy.current = true
    source.current = format
    setReading('vault')
    setError('')
    setReport(null)
    setOptimizedImages(0)
    try {
      const contents = await read()
      if (!contents) return
      const plan = await planVaultImport(contents, includeAttachments)
      if (props.cloud) {
        setReading('cloud')
        const { bindCloudImportFiles, cloudImportPlan } = await import('@/lib/cloud/import-plan')
        const baseline = cloudImportPlan(plan)
        const attempt = baseline.batches[0]?.importId
        if (!attempt) throw new Error('No pages are ready to import.')
        const response = await fetch('/api/import?' + new URLSearchParams({ attempt }), { cache: 'no-store' })
        if (!response.ok) throw new Error('Cloud import could not check the workspace’s image limits.')
        const settings: CloudImportImageContext = await response.json()
        const { prepareCloudImportImages } = await import('@/lib/cloud/prepare-images')
        const bound = await bindCloudImportFiles(baseline, settings.account, settings.current)
        const { batches, optimized } = await prepareCloudImportImages(bound.batches, settings)
        const cloudPlan = { ...bound, batches, account: settings.account }
        setOptimizedImages(optimized)
        setDraft(cloudPlan)
        setReading(null)
        await upload(cloudPlan)
        return
      }
      const result = props.onImport(plan)
      if (!result) throw new Error('The workspace is still opening. Try again when it is ready.')
      setReport(result)
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        setError(failure instanceof Error ? failure.message : 'The vault could not be read.')
      }
    } finally {
      busy.current = false
      setReading(null)
    }
  }

  function selectZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void run(() => readVaultZip(file, includeAttachments))
  }

  function selectFolder(event: ChangeEvent<HTMLInputElement>, format?: 'markdown') {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length) void run(() => readVaultFiles(files, includeAttachments), format)
  }

  const saved = report && (props.cloud || props.saveStatus === 'saved')
  const saveFailed = report && !props.cloud && (props.saveStatus === 'error' || props.saveStatus === 'conflict')
  const title = props.cloud ? 'Import to cloud workspace' : 'Import an Obsidian vault'

  return (
    <Dialog title={title} onClose={() => { if (!busy.current) onClose() }}>
      <div className="form-dialog vault-dialog">
        <h2>{title}</h2>
        <p>{props.cloud ? 'Upload Markdown files or an Obsidian vault to your private cloud workspace.'
          : 'Choose a ZIP archive or vault folder. Lekhan keeps your note hierarchy, properties, and page links.'}</p>
        <input ref={zip} type="file" accept=".zip,application/zip" hidden aria-label="Vault ZIP" onChange={selectZip} />
        <input ref={directory} type="file" {...{ webkitdirectory: "" }} multiple hidden aria-label="Vault folder" onChange={selectFolder} />
        {props.cloud && <input ref={markdown} type="file" accept=".md,.markdown,text/markdown" multiple hidden aria-label="Markdown files" onChange={event => selectFolder(event, 'markdown')} />}
        {!report && !draft && <div className="vault-options">
          <button className="secondary-button" disabled={!!reading} onClick={() => zip.current?.click()}><Archive size={17} /> Choose ZIP</button>
          <button className="secondary-button" disabled={!!reading} onClick={() => {
            if (!('showDirectoryPicker' in window) || !window.isSecureContext) {
              directory.current?.click()
            } else {
              void run(() => pickVaultFolder(includeAttachments))
            }
          }}><FolderOpen size={17} /> Choose folder</button>
          {props.cloud && <button className="secondary-button" disabled={!!reading} onClick={() => markdown.current?.click()}><FileText size={17} /> Choose Markdown</button>}
        </div>}
        {reading && <div role="status" className="vault-status">
          <LoaderCircle size={16} className="spin" /> {reading === 'cloud' ? 'Preparing cloud import…' : 'Reading vault…'}
        </div>}
        {progress && <div role="status" className="vault-status">
          {uploading && <LoaderCircle size={16} className="spin" />}
          {progress.saved} of {progress.total} pages saved{progress.resumed ? ` · ${progress.resumed} already imported` : ''}
          {progress.filesTotal ? ` · ${progress.files} of ${progress.filesTotal} files saved` : ''}
        </div>}
        {error && <div role="alert" className="vault-status vault-error"><AlertCircle size={16} /> {error}</div>}
        {report && <>
          <div role="status" className="vault-status">
            {saved ? <Check size={16} /> : saveFailed ? <AlertCircle size={16} /> : <LoaderCircle size={16} className="spin" />}
            {saved ? report.repeated ? 'Vault already imported' : props.cloud ? 'Import saved to cloud workspace' : 'Import saved locally'
              : saveFailed ? 'Import is open but could not be saved' : 'Saving imported pages…'}
          </div>
          <dl className="vault-report">
            {[
              ['Notes', report.notes], ['Folders', report.folders], ['Images', report.images],
              ...(report.files === undefined ? [] : [['Files saved', report.files]]),
              ...(report.omittedFiles ? [['Files left in the archive', report.omittedFiles]] : []),
              ['Resolved links', report.resolved], ['Unresolved links', report.unresolved],
              ['Converted embeds', report.degraded],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {!!report.omittedFiles && <p>Files without a page link or an archive attachment record stay in the source vault.</p>}
          {report.degraded > 0 && <p>Attachments Lekhan couldn’t display were kept as links.</p>}
          {optimizedImages > 0 && <p>{optimizedImages === 1 ? '1 image was' : `${optimizedImages} images were`} optimized for Free cloud storage.</p>}
          {report.invalidProperties > 0 && <p>Some properties could not be read. Their original YAML is still in the page source.</p>}
        </>}
        <div className="dialog-actions">
          <button className={saved && !props.cloud ? 'primary-button' : 'secondary-button'} onClick={onClose} disabled={!!reading || uploading}>
            {report ? props.cloud ? 'Done' : 'Open workspace' : 'Cancel'}
          </button>
          {props.cloud && error && draft && <button className="primary-button" disabled={uploading} onClick={resume}>Resume import</button>}
          {props.cloud && report && firstPage && <button className="primary-button" onClick={() => props.onOpenPage(firstPage)}>Open first note</button>}
        </div>
      </div>
    </Dialog>
  )
}
