'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AlertCircle, Archive, Check, FileText, FolderOpen, LoaderCircle } from 'lucide-react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { planVaultImport, type ImportReport, type VaultImportPlan } from '@/lib/vault-import'
import type { SaveStatus } from '@/lib/use-workspace'
import { pickVaultFolder, readVaultFiles, readVaultZip, type VaultContents } from '@/lib/vault-reader'
import { AttachmentTransferError, uploadImportedAttachment } from '@/lib/cloud/attachment-client'
import type { BoundCloudFile, cloudImportPlan, CloudImportReceipt } from '@/lib/cloud/import-plan'
import type { CloudImportImageContext } from '@/lib/cloud/prepare-images'
import { consumeAnalyticsReceipts, track } from '@/lib/analytics'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { VaultImportError } from '@/lib/vault-import-error'

type Destination = { cloud: true; onOpenPage: (id: string) => void }
  | { cloud?: false; onImport: (plan: VaultImportPlan) => ImportReport | null; includeAttachments?: boolean; saveStatus: SaveStatus }
type CloudDraft = Omit<ReturnType<typeof cloudImportPlan>, 'files'> & { files: BoundCloudFile[]; account?: string }

export function VaultImportDialog(props: Destination & { onClose: () => void }) {
  const { onClose } = props
  const t = useTranslations('vault-import')
  const fileText = useTranslations('cloud-dialogs')
  const numbers = new Intl.NumberFormat(useLocale())
  const includeAttachments = props.cloud || props.includeAttachments === true
  const zip = useRef<HTMLInputElement>(null)
  const directory = useRef<HTMLInputElement>(null)
  const markdown = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [draft, setDraft] = useState<CloudDraft | null>(null)
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

  async function upload(plan: CloudDraft) {
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
          if (detail?.error === 'import_free_image_limit') throw new VaultImportError('freeImageLimit')
          if (detail?.error === 'import_paid_image_limit') throw new VaultImportError('paidImageLimit')
          if (detail?.error === 'import_workspace_media_limit') throw new VaultImportError('workspaceImageLimit')
          if (detail?.error === 'import_image_policy_changed') {
            setDraft(null)
            throw new VaultImportError('imagePolicyChanged')
          }
        }
        if (result.status === 413) throw new VaultImportError('batchSizeLimit')
        if (result.status === 401 || result.status === 403) throw new VaultImportError('accountChanged')
        if (result.status === 400) throw new VaultImportError('invalidNote')
        if (result.status === 409) throw new VaultImportError('batchConflict')
        if (!result.ok) throw new VaultImportError('uploadFailed')
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
          if (!target) throw new VaultImportError('attachmentPageMissing')
          const replayed = await uploadImportedAttachment(target, file, plan.account)
          files++
          if (replayed) reusedFiles++
          updateProgress()
        }
      }
      if (files !== plan.files.length) throw new VaultImportError('attachmentPageMissing')
      setReport({ ...plan.report, ...(files ? { files } : {}), repeated: saved === resumed && files === reusedFiles })
      if (saved > resumed || files > reusedFiles) track('import_completed', source.current, plan.report.notes)
    } catch (failure) {
      setError(failure instanceof AttachmentTransferError ? fileText(failure.code)
        : failure instanceof VaultImportError ? t(failure.code, failure.values) : t('uploadFailed'))
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
    setProgress(null)
    setFirstPage(null)
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
        if (!attempt) throw new VaultImportError('noMarkdown')
        const response = await fetch('/api/import?' + new URLSearchParams({ attempt }), { cache: 'no-store' })
        if (response.status === 401 || response.status === 403) throw new VaultImportError('accountChanged')
        if (!response.ok) throw new VaultImportError('checkPlanFailed')
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
      if (!result) throw new VaultImportError('workspaceOpening')
      setReport(result)
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        setError(failure instanceof VaultImportError ? t(failure.code, failure.values) : t('readFailed'))
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
  const title = props.cloud ? t('cloudTitle') : t('localTitle')

  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open && !busy.current) onClose() }} width={540} padding={0}>
      <Layout
        header={<DialogHeader title={title} onOpenChange={open => { if (!open && !busy.current) onClose() }} />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              <Text color="secondary">{props.cloud ? t('cloudIntro') : t('localIntro')}</Text>
              <input ref={zip} type="file" accept=".zip,application/zip" hidden aria-label={t('vaultZip')} onChange={selectZip} />
              <input ref={directory} type="file" {...{ webkitdirectory: '' }} multiple hidden aria-label={t('vaultFolder')} onChange={selectFolder} />
              {props.cloud && <input ref={markdown} type="file" accept=".md,.markdown,text/markdown" multiple hidden aria-label={t('markdownFiles')} onChange={event => selectFolder(event, 'markdown')} />}
              {!report && !draft && (
                <HStack gap={2} wrap="wrap" className="vault-options">
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<Archive size={17} aria-hidden="true" />}
                    label={t('chooseZip')}
                    isDisabled={!!reading}
                    onClick={() => zip.current?.click()}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<FolderOpen size={17} aria-hidden="true" />}
                    label={t('chooseFolder')}
                    isDisabled={!!reading}
                    onClick={() => {
                      if (!('showDirectoryPicker' in window) || !window.isSecureContext) {
                        directory.current?.click()
                      } else {
                        void run(() => pickVaultFolder(includeAttachments))
                      }
                    }}
                  />
                  {props.cloud && (
                    <Button
                      type="button"
                      variant="secondary"
                      icon={<FileText size={17} aria-hidden="true" />}
                      label={t('chooseMarkdown')}
                      isDisabled={!!reading}
                      onClick={() => markdown.current?.click()}
                    />
                  )}
                </HStack>
              )}
              {reading && (
                <HStack gap={2} align="center" role="status" className="vault-status">
                  <LoaderCircle size={16} className="spin" aria-hidden="true" />
                  <Text size="sm">{reading === 'cloud' ? t('preparing') : t('reading')}</Text>
                </HStack>
              )}
              {progress && (
                <HStack gap={2} align="center" role="status" className="vault-status">
                  {uploading && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
                  <Text size="sm">
                    {t('pagesProgress', { saved: progress.saved, total: progress.total })}
                    {progress.resumed ? ' · ' + t('resumedProgress', { count: progress.resumed }) : ''}
                    {progress.filesTotal ? ' · ' + t('filesProgress', { saved: progress.files, total: progress.filesTotal }) : ''}
                  </Text>
                </HStack>
              )}
              {error && (
                <div role="alert">
                  <Banner status="error" collapsible={false} title={error} icon={<AlertCircle size={16} />} />
                </div>
              )}
              {report && (
                <VStack gap={3}>
                  <Banner
                    role="status"
                    status={saved ? 'success' : saveFailed ? 'error' : 'info'}
                    collapsible={false}
                    icon={saved ? <Check size={16} /> : saveFailed ? <AlertCircle size={16} /> : <LoaderCircle size={16} className="spin" />}
                    title={saved ? report.repeated ? t('alreadyImported') : props.cloud ? t('cloudSaved') : t('localSaved')
                      : saveFailed ? t('localSaveFailed') : t('saving')}
                  />
                  <MetadataList columns="multi">
                    <MetadataListItem label={t('notes')}>{numbers.format(report.notes)}</MetadataListItem>
                    <MetadataListItem label={t('folders')}>{numbers.format(report.folders)}</MetadataListItem>
                    <MetadataListItem label={t('images')}>{numbers.format(report.images)}</MetadataListItem>
                    {report.files !== undefined && <MetadataListItem label={t('filesSaved')}>{numbers.format(report.files)}</MetadataListItem>}
                    {!!report.omittedFiles && <MetadataListItem label={t('filesOmitted')}>{numbers.format(report.omittedFiles)}</MetadataListItem>}
                    <MetadataListItem label={t('resolved')}>{numbers.format(report.resolved)}</MetadataListItem>
                    <MetadataListItem label={t('unresolved')}>{numbers.format(report.unresolved)}</MetadataListItem>
                    <MetadataListItem label={t('converted')}>{numbers.format(report.degraded)}</MetadataListItem>
                  </MetadataList>
                  {!!report.omittedFiles && <Text type="supporting" color="secondary">{t('omittedNotice')}</Text>}
                  {report.degraded > 0 && <Text type="supporting" color="secondary">{t('degradedNotice')}</Text>}
                  {optimizedImages > 0 && <Text type="supporting" color="secondary">{t('optimized', { count: optimizedImages })}</Text>}
                  {report.invalidProperties > 0 && <Text type="supporting" color="secondary">{t('propertiesNotice')}</Text>}
                </VStack>
              )}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} justify="end">
              <Button
                type="button"
                variant={saved && !props.cloud ? 'primary' : 'secondary'}
                label={report ? props.cloud ? t('done') : t('openWorkspace') : t('cancel')}
                isDisabled={!!reading || uploading}
                onClick={onClose}
              />
              {props.cloud && error && draft && (
                <Button type="button" variant="primary" label={t('resume')} isDisabled={uploading} onClick={resume} />
              )}
              {props.cloud && report && firstPage && (
                <Button type="button" variant="primary" label={t('openFirst')} onClick={() => props.onOpenPage(firstPage)} />
              )}
            </HStack>
          </LayoutFooter>
        }
      />
    </AstryxDialog>
  )
}
