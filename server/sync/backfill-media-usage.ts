import * as Y from 'yjs'
import { createServerAdmin } from '../../lib/auth/admin.ts'
import { documentImageBytes, documentImages, imageRoots } from './document-images.ts'
import { recordPageImages } from './media-usage.ts'
import { configuredSnapshotCipher } from './snapshot.ts'
import { cloudSnapshots } from './supabase.ts'

const admin = createServerAdmin()
const cipher = configuredSnapshotCipher()
if (!admin || !cipher) throw new Error('Configure Supabase and snapshot encryption before backfilling storage usage.')

const snapshots = cloudSnapshots(admin, cipher)
let after: string | undefined
let updated = 0
do {
  let query = admin.from('pages').select('id').order('id').limit(100)
  if (after) query = query.gt('id', after)
  const batch = await query.returns<{ id: string }[]>()
  if (batch.error) throw batch.error
  for (const { id } of batch.data) {
    const doc = new Y.Doc()
    try {
      const roots = imageRoots(doc)
      const snapshot = await snapshots.load(id)
      if (snapshot) Y.applyUpdate(doc, snapshot)
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error(`Incomplete snapshot on page ${id}.`)
      await recordPageImages(admin, id, documentImageBytes(documentImages(roots)))
      updated++
    } finally {
      doc.destroy()
    }
  }
  after = batch.data.length === 100 ? batch.data.at(-1)?.id : undefined
} while (after)

console.log(`Updated storage usage for ${updated} cloud pages.`)
