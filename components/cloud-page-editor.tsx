'use client'

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Cloud, CloudOff, Download, History, LoaderCircle, LockKeyhole, Paperclip } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Item } from '@astryxdesign/core/Item'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import type { PageChoice } from '@/lib/types'
import type { CloudPage, PageRole } from '@/lib/cloud/graph'
import { forgetCloudSearchPage, rememberCloudSearchPage } from '@/lib/cloud/local-search'
import { importPathKey } from '@/lib/cloud/graph-index'
import { useTranslations } from '@/lib/i18n/client'
import { SyncPreferenceConflict, useCloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import { replaceSourceText } from '@/lib/sync/replace-source'
import { transferCloudAttachment, transferredFilename } from '@/lib/cloud/attachment-client'
import { attachmentReference } from '@/lib/local-attachments'
import { downloadBlob } from '@/lib/downloads'
import { wikiLinks } from '@/lib/markdown-references'
import { trackWritingEdit } from '@/lib/analytics'
import PageEditor from './page-editor'
import CheckpointDialog from './checkpoint-dialog'
import CloudImageControl from './editor/cloud-image-control'
import CloudAttachments from './cloud-attachments'
import CloudExportDialog from './cloud-export-dialog'
import { AssistedMarkdownSource } from './editor/selection-ai'
import { useEditorPreferences } from './settings/appearance-settings'

function useReplicaSource(document: ReturnType<typeof useCloudCollaboration>['session']) {
  const subscribe = useCallback((changed: () => void) => {
    if (!document) return () => {}
    const notify = () => changed()
    document.document.on('update', notify)
    return () => document.document.off('update', notify)
  }, [document])
  const get = useCallback(() => document?.document.getMap('lekhan').get('mode') === 'source'
    ? document.document.getText('source').toString()
    : null, [document])
  return useSyncExternalStore(subscribe, get, () => null)
}

function CloudLinkChoices({ source, onLoad }: { source: Promise<PageChoice[]>; onLoad: (choices: PageChoice[]) => void }) {
  const choices = use(source)
  useEffect(() => { onLoad(choices) }, [choices, onLoad])
  return null
}

function scrollToHeading(root: HTMLElement, anchor: string) {
  const key = anchor.trim().normalize('NFC').toLowerCase()
  const heading = Array.from(root.querySelectorAll<HTMLElement>('.writer-content :is(h1,h2,h3,h4,h5,h6)'))
    .find(item => item.textContent?.trim().normalize('NFC').toLowerCase() === key)
  heading?.scrollIntoView({ block: 'start' })
  return !!heading
}

export default function CloudPageEditor({ page, subject, linkChoices, role, enabled, offlineChoices, onAccessLost, onOpenOfflinePage }: {
  page: CloudPage
  subject: string
  linkChoices?: Promise<PageChoice[]>
  offlineChoices?: PageChoice[]
  onAccessLost?: () => void
  onOpenOfflinePage?: (id: string, fragment: string) => void
  role: PageRole
  enabled: boolean
}) {
  const t = useTranslations('editor-chrome')
  const cloudText = useTranslations('cloud-workspace')
  const exportText = useTranslations('cloud-export')
  const offlineText = useTranslations('cloud-offline')
  const { spellcheck } = useEditorPreferences()
  const offlineShell = offlineChoices !== undefined
  const replica = useCloudCollaboration(page.id, subject, enabled, role !== 'viewer', offlineShell)
  const source = useReplicaSource(replica.session)
  const largeSource = source !== null && source.length >= 1024 * 1024
  const references = useMemo(() => source === null ? [] : [...new Map(
    wikiLinks(source).map(link => [link.target, link]),
  ).values()], [source])
  const router = useRouter()
  const [onlineChoices, setChoices] = useState<PageChoice[]>([])
  const choices = offlineChoices ?? onlineChoices
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState(false)
  const [linkMissing, setLinkMissing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const download = useRef<AbortController | null>(null)
  const [attachmentDownload, setAttachmentDownload] = useState<'running' | 'failed' | null>(null)
  useEffect(() => () => download.current?.abort(), [])
  const [changingSync, setChangingSync] = useState(false)
  const [preferenceError, setPreferenceError] = useState<'syncPreferenceRequired' | 'syncPreferenceFailed' | null>(null)
  const [preview, setPreview] = useState(false)
  const [heading, setHeading] = useState('')
  const editorRoot = useRef<HTMLDivElement>(null)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const editable = replica.writable && !schemaError
  const syncPaused = replica.status === 'image-limit' || replica.status === 'payload-limit' || replica.status === 'workspace-media-limit'
  const localOnly = replica.status === 'local-only'
  const checkingSync = replica.status === 'opening' && !!replica.session
  const networkLabel = !enabled ? cloudText('syncUnavailable') : replica.status === 'live' ? cloudText('live')
    : replica.status === 'offline' ? replica.session ? offlineText('offlineCopy') : offlineText('waiting')
    : replica.status === 'denied' ? offlineText('accessExpired')
    : replica.status === 'limit' ? cloudText('collaboratorLimitReached')
    : localOnly ? cloudText('cloudPaused')
    : syncPaused ? cloudText('syncPaused') : checkingSync ? t('checkingCloudCopy') : cloudText('openingPage')
  const exportable = !!replica.session && !schemaError && (source !== null || markdown !== null)
  const searchableText = source ?? markdown
  const frontmatter = exportOpen ? replica.session?.document.getMap('lekhan').get('frontmatter') : null

  useEffect(() => {
    function readHeading() {
      const hash = window.location.hash
      if (!hash.startsWith('#heading=')) return
      try {
        setHeading(decodeURIComponent(hash.slice('#heading='.length)))
        setPreview(true)
      } catch { /* An invalid fragment does not affect the page. */ }
    }
    readHeading()
    window.addEventListener('hashchange', readHeading)
    return () => window.removeEventListener('hashchange', readHeading)
  }, [])

  useEffect(() => {
    const root = editorRoot.current
    if (!heading || !root) return
    const reveal = () => {
      if (scrollToHeading(root, heading)) {
        observer.disconnect()
        setHeading('')
      }
    }
    const observer = new MutationObserver(reveal)
    observer.observe(root, { childList: true, characterData: true, subtree: true })
    const frame = window.requestAnimationFrame(reveal)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [heading])

  useEffect(() => {
    if (replica.status === 'denied' || replica.status === 'limit') {
      void forgetCloudSearchPage(subject, page.id).catch(() => undefined).finally(() => onAccessLost?.())
      return
    }
    if (!replica.session || replica.status === 'opening' || schemaError || searchableText === null) return
    const timer = setTimeout(() => {
      void rememberCloudSearchPage(subject, {
        id: page.id, title: page.title, markdown: searchableText, properties: page.properties ?? undefined, updatedAt: page.updated_at, role,
      }, replica.verifiedAt).catch(() => undefined)
    }, 350)
    return () => clearTimeout(timer)
  }, [onAccessLost, page.id, page.title, page.properties, page.updated_at, replica.session, replica.status, replica.verifiedAt, role, schemaError, searchableText, subject])

  async function openLink(target: string) {
    const [title, anchor] = target.split('#', 2).map(part => part.trim())
    if (!title && anchor) {
      setPreview(true)
      if (!editorRoot.current || !scrollToHeading(editorRoot.current, anchor)) setHeading(anchor)
      return
    }
    setLinkMissing(false)
    const fragment = anchor ? '#heading=' + encodeURIComponent(anchor) : ''
    const key = importPathKey(title)
    const matches = choices.filter(choice => importPathKey(choice.path) === key)
    if (offlineShell) {
      if (matches.length === 1) {
        if (onOpenOfflinePage) onOpenOfflinePage(matches[0].id, fragment)
        else {
          const target = new URL('/cloud-offline', window.location.origin)
          target.searchParams.set('page', matches[0].id)
          target.hash = fragment
          window.location.assign(target.href)
        }
      } else setLinkMissing(true)
      return
    }
    let serverUnreachable = false
    try {
      const response = await fetch('/api/page-link?' + new URLSearchParams({ pageId: page.id, target: title.trim() }), {
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        const { id } = await response.json()
        if (id) router.push('/page/' + id + fragment)
        else setLinkMissing(true)
        return
      }
      if (response.status < 500) { setLinkMissing(true); return }
      serverUnreachable = true
    } catch {
      serverUnreachable = true
    }
    if (matches.length === 1) {
      if (serverUnreachable) {
        const target = new URL('/page/' + matches[0].id, window.location.origin)
        target.hash = fragment
        window.location.assign(target.href)
      } else router.push('/page/' + matches[0].id + fragment)
    } else setLinkMissing(true)
  }

  function writeSource(next: string, expected?: string) {
    const document = replica.session?.document
    if (!document || !editable) return false
    const text = document.getText('source')
    const current = text.toString()
    if (expected !== undefined && current !== expected) return false
    if (current === next) return true
    document.transact(() => replaceSourceText(text, current, next))
    trackWritingEdit(current, next)
    return true
  }

  function openAttachment(href: string) {
    const file = attachmentReference(href)
    if (!file) return false
    if (download.current) return true
    const transfer = new AbortController()
    download.current = transfer
    setAttachmentDownload('running')
    const signal = AbortSignal.any([transfer.signal, AbortSignal.timeout(120_000)])
    void transferCloudAttachment(page.id, file.id, { method: 'GET', signal }, subject).then(async reply => {
      const blob = await reply.blob()
      signal.throwIfAborted()
      downloadBlob(transferredFilename(reply), blob)
      setAttachmentDownload(null)
    }).catch(() => {
      if (!transfer.signal.aborted) setAttachmentDownload('failed')
    }).finally(() => { download.current = null })
    return true
  }

  async function toggleCloudSync() {
    setChangingSync(true)
    setPreferenceError(null)
    try { await replica.changeSyncPreference(replica.preference === 'paused') }
    catch (error) { setPreferenceError(error instanceof SyncPreferenceConflict ? 'syncPreferenceRequired' : 'syncPreferenceFailed') }
    finally { setChangingSync(false) }
  }

  return (
    <div className="cloud-editor" ref={editorRoot}>
      {linkChoices && <Suspense><CloudLinkChoices source={linkChoices} onLoad={setChoices} /></Suspense>}
      <HStack gap={2} align="center" wrap="wrap" className="cloud-editor-status">
        <span role="status">
          {replica.status === 'live' ? <Cloud size={16} /> : replica.status === 'opening' && enabled && !checkingSync
            ? <LoaderCircle size={16} className="spin" /> : <CloudOff size={16} />}
          {networkLabel}
        </span>
        {replica.session && !editable && <span><LockKeyhole size={15} /> {checkingSync && role !== 'viewer' ? t('checkingCloudAccess') : offlineText('viewing')}</span>}
        {source !== null && (
          <ToggleButton
            size="sm"
            label={offlineText('preview')}
            isPressed={preview}
            onPressedChange={setPreview}
          />
        )}
        {source !== null && !preview && editable && replica.imagePolicy && (
          <CloudImageControl policy={replica.imagePolicy} onInsert={(src, label) => {
            const input = sourceInput.current
            if (!input || input.readOnly) return
            const alt = label.replace(/[\[\]\\]/g, '')
            const from = input.selectionStart
            const to = input.selectionEnd
            writeSource(input.value.slice(0, from) + `\n\n![${alt}](${src})\n\n` + input.value.slice(to))
          }} />
        )}
        {replica.session && !offlineShell && (
          <Button type="button" variant="secondary" size="sm" icon={<History size={15} />} label={cloudText('history')} onClick={() => setHistoryOpen(true)} />
        )}
        {replica.session && !offlineShell && !localOnly && (
          <Button type="button" variant="secondary" size="sm" icon={<Paperclip size={15} />} label={cloudText('attachments')} onClick={() => setAttachmentsOpen(true)} />
        )}
        {exportable && (
          <Button type="button" variant="secondary" size="sm" icon={<Download size={15} />} label={exportText('title')} onClick={() => setExportOpen(true)} />
        )}
        {!offlineShell && (replica.preference === 'personal' || replica.preference === 'paused') && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isDisabled={changingSync || (!localOnly && replica.status !== 'live')}
            label={replica.preference === 'paused' ? cloudText('resumeSync') : cloudText('pauseSync')}
            onClick={() => void toggleCloudSync()}
          />
        )}
      </HStack>
      {attachmentDownload === 'running' && <Text type="supporting" role="status">{exportText('downloadingAttachment')}</Text>}
      {attachmentDownload === 'failed' && <div role="alert"><Banner status="error" collapsible={false} title={exportText('attachmentUnavailable')} /></div>}
      {preferenceError && <div role="alert"><Banner status="error" collapsible={false} title={cloudText(preferenceError)} /></div>}
      {localOnly && (
        <Banner status="info" collapsible={false} title={replica.session ? cloudText('localOnlyCopy') : cloudText('localCopyMissing')} />
      )}
      {linkMissing && (
        <div role="status"><Banner status="warning" collapsible={false} title={offlineShell ? offlineText('linkMissing') : cloudText('linkUnavailable')} /></div>
      )}
      {replica.status === 'limit' && <Text color="secondary">{cloudText('reviewSharing')}</Text>}
      {syncPaused && (
        <div role="status">
          <Banner
            status="warning"
            collapsible={false}
            title={cloudText(replica.status === 'payload-limit' ? 'draftTooLarge'
              : replica.status === 'workspace-media-limit' ? 'workspaceFull'
                : replica.imagePolicy === 'paid' ? 'paidImageTooLarge' : 'freeImageTooLarge')}
            endContent={<Button type="button" variant="secondary" size="sm" label={cloudText('retrySync')} onClick={replica.retrySync} />}
          />
        </div>
      )}
      {offlineShell && !replica.session && replica.status === 'offline' && <div role="alert"><Banner status="warning" collapsible={false} title={offlineText('missingCopy')} /></div>}
      {schemaError && <div role="alert"><Banner status="error" collapsible={false} title={cloudText('unsupportedBlocks')} /></div>}
      {replica.session && (source === null ? <PageEditor
        pageId={page.id}
        markdown=""
        choices={choices}
        onChange={setMarkdown}
        onOpenLink={openLink}
        onOpenAttachment={openAttachment}
        onSchemaError={() => setSchemaError(true)}
        collaboration={replica.session}
        imagePolicy={replica.imagePolicy}
        editable={editable}
        assistant={offlineShell && replica.status !== 'live' ? undefined : { storageScope: 'account:' + subject }}
      /> : preview ? <PageEditor
        pageId={page.id} markdown={source} choices={choices} onChange={() => {}} showModePicker={false} editable={false} onOpenLink={openLink} onOpenAttachment={openAttachment}
      /> : <AssistedMarkdownSource key={page.id} ref={sourceInput} className={largeSource ? 'writer-source writer-source-bounded' : 'writer-source'}
        wrap={largeSource ? 'off' : 'soft'} aria-label={t('markdownSource')} markdown={source} readOnly={!editable} spellCheck={spellcheck}
        assistant={offlineShell && replica.status !== 'live' ? undefined : { storageScope: 'account:' + subject }} onChange={writeSource} onApply={writeSource} />)}
      {references.length > 0 && (
        <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">{cloudText('pageLinks', { count: references.length })}</Text>} className="cloud-page-actions cloud-references">
          <VStack gap={1}>
            {references.map(link => (
              <Item key={link.target} density="compact" label={link.alias || link.target} onClick={() => void openLink(link.target)} />
            ))}
          </VStack>
        </Collapsible>
      )}
      {replica.session && historyOpen && <CheckpointDialog pageId={page.id} session={replica.session}
        live={replica.status === 'live'} writable={editable} onClose={() => setHistoryOpen(false)} />}
      {exportable && exportOpen && <CloudExportDialog markdownOnly={offlineShell} page={{
        id: page.id, parentId: page.parent_id, title: page.title, markdown: source ?? markdown ?? '',
        ...(typeof frontmatter === 'string' ? { frontmatter } : {}),
        ...(page.properties ? { properties: page.properties } : {}),
        favorite: false, createdAt: page.updated_at, updatedAt: page.updated_at,
      }} onClose={() => setExportOpen(false)} />}
      {replica.session && attachmentsOpen && <CloudAttachments pageId={page.id} onClose={() => setAttachmentsOpen(false)} />}
    </div>
  )
}
