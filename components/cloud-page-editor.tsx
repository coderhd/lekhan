'use client'

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Cloud, CloudOff, Download, History, LoaderCircle, LockKeyhole, Paperclip } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { PageChoice } from '@/lib/types'
import type { CloudPage } from '@/lib/cloud/graph'
import { useCloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import { replaceSourceText } from '@/lib/sync/replace-source'
import { downloadPage } from '@/lib/downloads'
import { wikiLinks } from '@/lib/markdown-references'
import { trackWritingEdit } from '@/lib/analytics'
import PageEditor from './page-editor'
import CheckpointDialog from './checkpoint-dialog'
import CloudImageControl from './editor/cloud-image-control'
import CloudAttachments from './cloud-attachments'

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

export default function CloudPageEditor({ page, subject, choices, enabled }: {
  page: CloudPage
  subject: string
  choices: PageChoice[]
  enabled: boolean
}) {
  const replica = useCloudCollaboration(page.id, subject, enabled)
  const source = useReplicaSource(replica.session)
  const largeSource = source !== null && source.length >= 1024 * 1024
  const references = useMemo(() => source === null ? [] : [...new Map(
    wikiLinks(source).map(link => [link.target, link]),
  ).values()], [source])
  const router = useRouter()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState(false)
  const [linkMissing, setLinkMissing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const editable = replica.writable && !schemaError
  const syncPaused = replica.status === 'image-limit' || replica.status === 'payload-limit'
  const networkLabel = !enabled ? 'Cloud sync unavailable' : replica.status === 'live' ? 'Live'
    : replica.status === 'offline' ? replica.session ? 'Offline copy' : 'Waiting for sync'
    : replica.status === 'denied' ? 'Access expired'
    : replica.status === 'limit' ? 'Collaborator limit reached'
    : syncPaused ? 'Sync paused' : 'Opening cloud page'
  const exportable = !!replica.session && !schemaError && (source !== null || markdown !== null)

  async function openLink(target: string) {
    const [title, anchor] = target.split('#', 2)
    if (!title && anchor) {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('.writer-content :is(h1,h2,h3,h4,h5,h6)'))
        .find(item => item.textContent?.trim().toLowerCase() === anchor.toLowerCase())
      heading?.scrollIntoView({ block: 'start' })
      return
    }
    setLinkMissing(false)
    try {
      const response = await fetch('/api/page-link?' + new URLSearchParams({ pageId: page.id, target: title.trim() }), {
        cache: 'no-store', signal: AbortSignal.timeout(5000),
      })
      if (response.ok) {
        const { id } = await response.json()
        if (id) { router.push('/page/' + id); return }
      }
    } catch {
      // The open document still knows about recently listed pages when offline.
    }
    const matches = choices.filter(choice => choice.path.toLowerCase() === title.trim().toLowerCase())
    if (matches.length === 1) router.push('/page/' + matches[0].id)
    else setLinkMissing(true)
  }

  function writeSource(next: string) {
    const document = replica.session?.document
    if (!document || !editable) return
    const text = document.getText('source')
    const current = text.toString()
    if (current === next) return
    document.transact(() => replaceSourceText(text, current, next))
    trackWritingEdit(current, next)
  }

  return (
    <div className="cloud-editor">
      <div className="cloud-editor-status">
        <span role="status">
          {replica.status === 'live' ? <Cloud size={16} /> : replica.status === 'opening' && enabled
            ? <LoaderCircle size={16} className="spin" /> : <CloudOff size={16} />}
          {networkLabel}
        </span>
        {replica.session && !editable && <span><LockKeyhole size={15} /> Viewing access</span>}
        {source !== null && <button type="button" className="secondary-button" aria-pressed={preview} onClick={() => setPreview(value => !value)}>
          Preview Markdown
        </button>}
        {source !== null && !preview && editable && replica.imagePolicy &&
          <CloudImageControl policy={replica.imagePolicy} onInsert={(src, label) => {
            const input = sourceInput.current
            if (!input || input.readOnly) return
            const alt = label.replace(/[\[\]\\]/g, '')
            const from = input.selectionStart
            const to = input.selectionEnd
            writeSource(input.value.slice(0, from) + `\n\n![${alt}](${src})\n\n` + input.value.slice(to))
          }} />}
        {replica.session && <button type="button" className="secondary-button" onClick={() => setHistoryOpen(true)}>
          <History size={15} /> Version history
        </button>}
        {replica.session && <button type="button" className="secondary-button" onClick={() => setAttachmentsOpen(true)}>
          <Paperclip size={15} /> Attachments
        </button>}
        {exportable && <button type="button" className="secondary-button" onClick={() => {
          const raw = replica.session?.document.getMap('lekhan').get('frontmatter')
          downloadPage({
            id: page.id, parentId: page.parent_id, title: page.title, markdown: source ?? markdown ?? '',
            ...(typeof raw === 'string' ? { frontmatter: raw } : {}),
            favorite: false, createdAt: page.updated_at, updatedAt: page.updated_at,
          })
        }}><Download size={15} /> Export page</button>}
      </div>
      {linkMissing && <p className="account-error" role="status">There is no matching page in this link picker. Find the page in your cloud workspace.</p>}
      {replica.status === 'limit' && <p>Ask the page owner to review sharing or change the workspace plan.</p>}
      {syncPaused && <div className="billing-notice" role="status">
        <p>{replica.status === 'payload-limit' ? 'This draft exceeds the page sync size limit.'
          : replica.imagePolicy === 'paid' ? 'A new image exceeds the 20 MB cloud limit.'
            : 'New images on Free must be WebP, up to 500 KB and 1,600 pixels per side.'} Your edits are in this browser.
          {replica.status === 'payload-limit' ? ' Reduce the draft size and try again.' : ' Remove or replace the image to resume sharing.'}</p>
        <button type="button" className="secondary-button" onClick={replica.retrySync}>Retry sync</button>
      </div>}
      {schemaError && <p className="account-error" role="alert">This page contains blocks the editor cannot open safely. Editing and export are paused for this page.</p>}
      {replica.session && (source === null ? <PageEditor
        pageId={page.id}
        markdown=""
        choices={choices}
        onChange={setMarkdown}
        onOpenLink={openLink}
        onSchemaError={() => setSchemaError(true)}
        collaboration={replica.session}
        imagePolicy={replica.imagePolicy}
        editable={editable}
      /> : preview ? <PageEditor
        pageId={page.id} markdown={source} choices={choices} onChange={() => {}} showModePicker={false} editable={false} onOpenLink={openLink}
      /> : <textarea ref={sourceInput} className={largeSource ? 'writer-source writer-source-bounded' : 'writer-source'}
        wrap={largeSource ? 'off' : 'soft'} aria-label="Markdown source" value={source} readOnly={!editable}
        onChange={event => writeSource(event.target.value)} />)}
      {references.length > 0 && <details className="cloud-page-actions cloud-references">
        <summary>Page links ({references.length})</summary>
        <ul>{references.map(link => <li key={link.target}>
          <button className="account-link" type="button" onClick={() => void openLink(link.target)}>{link.alias || link.target}</button>
        </li>)}</ul>
      </details>}
      {replica.session && historyOpen && <CheckpointDialog pageId={page.id} session={replica.session}
        live={replica.status === 'live'} writable={editable} onClose={() => setHistoryOpen(false)} />}
      {replica.session && attachmentsOpen && <CloudAttachments pageId={page.id} onClose={() => setAttachmentsOpen(false)} />}
    </div>
  )
}
