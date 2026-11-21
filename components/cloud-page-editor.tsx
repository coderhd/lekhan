'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { Cloud, CloudOff, Download, History, LoaderCircle, LockKeyhole } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { PageChoice } from '@/lib/types'
import type { CloudPage } from '@/lib/cloud/graph'
import { useCloudCollaboration } from '@/lib/sync/use-cloud-collaboration'
import { downloadPage } from '@/lib/downloads'
import { wikiLinks } from '@/lib/markdown-references'
import PageEditor from './page-editor'
import CheckpointDialog from './checkpoint-dialog'

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
  const references = useMemo(() => source === null ? [] : [...new Map(
    wikiLinks(source).map(link => [link.target, link]),
  ).values()], [source])
  const router = useRouter()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [schemaError, setSchemaError] = useState(false)
  const [linkMissing, setLinkMissing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const editable = replica.writable && !schemaError
  const networkLabel = !enabled ? 'Cloud sync unavailable' : replica.status === 'live' ? 'Live'
    : replica.status === 'offline' ? replica.session ? 'Offline copy' : 'Waiting for sync'
    : replica.status === 'denied' ? 'Access expired' : 'Opening cloud page'
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
    let start = 0
    let suffix = 0
    while (start < current.length && start < next.length && current[start] === next[start]) start++
    while (suffix < current.length - start && suffix < next.length - start &&
      current[current.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
    if (start > 0 && /[\uD800-\uDBFF]/.test(current[start - 1] ?? '')) start--
    if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? '')) suffix--
    document.transact(() => {
      const removed = current.length - start - suffix
      if (removed > 0) text.delete(start, removed)
      const inserted = next.slice(start, next.length - suffix)
      if (inserted) text.insert(start, inserted)
    })
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
        {replica.session && <button type="button" className="secondary-button" onClick={() => setHistoryOpen(true)}>
          <History size={15} /> Version history
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
      {schemaError && <p className="account-error" role="alert">This page contains blocks the editor cannot open safely. Editing and export are paused for this page.</p>}
      {replica.session && (source === null ? <PageEditor
        pageId={page.id}
        markdown=""
        choices={choices}
        onChange={setMarkdown}
        onOpenLink={openLink}
        onSchemaError={() => setSchemaError(true)}
        collaboration={replica.session}
        editable={editable}
      /> : preview ? <PageEditor
        pageId={page.id} markdown={source} choices={choices} onChange={() => {}} showModePicker={false} editable={false} onOpenLink={openLink}
      /> : <textarea className="writer-source" aria-label="Markdown source" value={source} readOnly={!editable} onChange={event => writeSource(event.target.value)} />)}
      {references.length > 0 && <details className="cloud-page-actions cloud-references">
        <summary>Page links ({references.length})</summary>
        <ul>{references.map(link => <li key={link.target}>
          <button className="account-link" type="button" onClick={() => void openLink(link.target)}>{link.alias || link.target}</button>
        </li>)}</ul>
      </details>}
      {replica.session && historyOpen && <CheckpointDialog pageId={page.id} session={replica.session}
        live={replica.status === 'live'} writable={editable} onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
