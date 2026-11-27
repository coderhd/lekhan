'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Paperclip, Trash2 } from 'lucide-react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { attachmentName, type CloudAttachment } from '@/lib/cloud/attachments'
import { AttachmentTransferError, listCloudAttachments, transferCloudAttachment, type CloudAttachmentList } from '@/lib/cloud/attachment-client'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { downloadBlob } from '@/lib/downloads'

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
  const fileInput = useRef<HTMLInputElement>(null)

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

  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open) onClose() }} width={540} padding={0}>
      <Layout
        header={<DialogHeader title={cloud('attachments')} onOpenChange={open => { if (!open) onClose() }} />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              {error && <div role="alert"><Banner status="error" collapsible={false} title={error} /></div>}
              {(busy || message) && <div role="status"><Banner status="info" collapsible={false} title={busy || message} /></div>}
              {!list && (error
                ? <Button type="button" variant="secondary" label={t('retry')} onClick={() => { setError(null); setReload(value => value + 1) }} />
                : <Text type="supporting" role="status">{t('loadingAttachments')}</Text>)}
              {list?.writable && (
                <HStack gap={2} align="center" wrap="wrap">
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    aria-label={t('attachFile')}
                    onChange={event => {
                      const file = event.currentTarget.files?.[0]
                      event.currentTarget.value = ''
                      if (file) pick(file)
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Paperclip size={16} aria-hidden="true" />}
                    isDisabled={!!busy}
                    label={t('attachFile')}
                    onClick={() => fileInput.current?.click()}
                  />
                  <Text type="supporting" color="secondary">{t('maxFileSize', { size: formatBytes(list.maxBytes, locale) })}</Text>
                </HStack>
              )}
              {list && (!list.files.length ? <Text color="secondary">{t('noAttachments')}</Text> : (
                <VStack gap={1}>
                  {list.files.map(file => (
                    <Item
                      key={file.id}
                      density="compact"
                      startContent={<FileText size={17} aria-hidden="true" />}
                      label={file.filename}
                      description={formatBytes(file.byte_count, locale)}
                      isDisabled={!!busy}
                      aria-label={t('downloadFile', { name: file.filename })}
                      onClick={() => download(file)}
                      endContent={
                        <HStack gap={1} align="center">
                          <Download size={16} aria-hidden="true" />
                          {list.canRemove && (
                            <IconButton
                              variant="ghost"
                              size="sm"
                              isDisabled={!!busy}
                              label={t('removeFileLabel', { name: file.filename })}
                              tooltip={t('removeFileLabel', { name: file.filename })}
                              icon={<Trash2 size={16} />}
                              onClick={event => { event.stopPropagation(); setPendingRemoval(file) }}
                            />
                          )}
                        </HStack>
                      }
                    />
                  ))}
                </VStack>
              ))}
              {list?.after && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isDisabled={!!busy}
                  label={t('loadMore')}
                  onClick={() => {
                    const after = list.after
                    void act(t('loadingMoreFiles'), async signal => {
                      const next = await listCloudAttachments(pageId, signal, after)
                      setList(current => current && { ...next, files: Array.from(new Map([...current.files, ...next.files].map(file => [file.id, file])).values()) })
                    })
                  }}
                />
              )}
              {pendingRemoval && (
                <AlertDialog
                  isOpen
                  onOpenChange={open => { if (!open) setPendingRemoval(null) }}
                  title={pendingRemoval.filename}
                  description={t('confirmRemoveFile', { name: pendingRemoval.filename })}
                  cancelLabel={t('cancel')}
                  actionLabel={t('removeFile')}
                  actionVariant="destructive"
                  isActionLoading={!!busy}
                  onAction={() => remove(pendingRemoval)}
                />
              )}
            </VStack>
          </LayoutContent>
        }
      />
    </AstryxDialog>
  )
}
