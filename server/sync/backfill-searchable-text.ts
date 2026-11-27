import * as Y from 'yjs'
import { createServerAdmin } from '../../lib/auth/admin.ts'
import { configuredSnapshotCipher } from './snapshot.ts'
import { cloudSnapshots, indexedDocument } from './supabase.ts'

const args = process.argv.slice(2)
const apply = args.length === 1 && args[0] === '--apply'
if (args.length && !apply) throw new Error('Run without arguments for a scan, or pass --apply to fill the index.')

const admin = createServerAdmin()
const cipher = configuredSnapshotCipher()
if (!admin || !cipher) throw new Error('Configure Supabase and snapshot encryption before backfilling searchable text.')

const snapshots = cloudSnapshots(admin, cipher)
const missingText = 'searchable_text.is.null,searchable_text.eq.'
const counts = { scanned: 0, missingSnapshot: 0, emptySnapshot: 0, ready: 0, updated: 0, changed: 0 }
type Candidate = { id: string; source_document_id: string | null; updated_at: string }
let after: string | undefined

do {
  let query = admin.from('pages').select('id,source_document_id,updated_at').or(missingText).order('id').limit(100)
  if (after) query = query.gt('id', after)
  const batch = await query.returns<Candidate[]>()
  if (batch.error) throw batch.error

  for (const page of batch.data) {
    counts.scanned++
    const snapshot = await snapshots.load(page.id) ?? (
      page.source_document_id && page.source_document_id !== page.id
        ? await snapshots.load(page.source_document_id)
        : null
    )
    if (!snapshot) {
      counts.missingSnapshot++
      continue
    }

    const doc = new Y.Doc()
    let text: string
    try {
      Y.applyUpdate(doc, snapshot)
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error(`Incomplete snapshot on page ${page.id}.`)
      text = indexedDocument(doc)
    } finally {
      doc.destroy()
    }
    if (!text.trim()) {
      counts.emptySnapshot++
      continue
    }

    counts.ready++
    if (apply) {
      // A concurrent save or manual repair takes precedence over the scanned snapshot.
      const { data, error } = await admin.from('pages').update({ searchable_text: text })
        .eq('id', page.id).eq('updated_at', page.updated_at).or(missingText).select('id').maybeSingle()
      if (error) throw error
      if (data) counts.updated++
      else counts.changed++
    }
  }

  after = batch.data.length === 100 ? batch.data.at(-1)?.id : undefined
} while (after)

console.log(JSON.stringify({ mode: apply ? 'apply' : 'scan', ...counts }))
