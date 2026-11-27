'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileArchive } from 'lucide-react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
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

  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open) close() }} width={480} padding={0}>
      <Layout
        header={<DialogHeader title={t('title')} subtitle={page.title} onOpenChange={open => { if (!open) close() }} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <VStack gap={1.5} align="start">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<Download size={16} aria-hidden="true" />}
                  isDisabled={working}
                  label={t('markdown')}
                  onClick={() => { downloadPage(page); onClose() }}
                />
                <Text type="supporting" color="secondary">{t('markdownDescription')}</Text>
              </VStack>
              {!markdownOnly && (
                <VStack gap={1.5} align="start">
                  <Button
                    type="button"
                    variant="primary"
                    icon={<FileArchive size={16} aria-hidden="true" />}
                    isDisabled={working}
                    isLoading={working}
                    label={t('zip')}
                    onClick={() => void exportZip()}
                  />
                  <Text type="supporting" color="secondary">{t('zipDescription')}</Text>
                </VStack>
              )}
              {working && (
                <Text type="supporting" role="status">
                  {progress && progress.total > 0 ? t('progress', { completed: progress.completed, total: progress.total }) : t('preparing')}
                </Text>
              )}
              {failure && (
                <div role="alert">
                  <Banner status="error" collapsible={false} title={t('failed')} />
                </div>
              )}
              {complete && (
                <div role="status">
                  <Banner status="success" collapsible={false} title={t('complete')} />
                </div>
              )}
            </VStack>
          </LayoutContent>
        }
        footer={working ? (
          <LayoutFooter hasDivider>
            <HStack justify="end">
              <Button type="button" variant="secondary" label={t('cancel')} onClick={close} />
            </HStack>
          </LayoutFooter>
        ) : undefined}
      />
    </AstryxDialog>
  )
}
