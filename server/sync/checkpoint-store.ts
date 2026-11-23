import type { SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { type Checkpoint } from '../../lib/cloud/checkpoints.ts'
import { cloudImageAllowed, type CloudImagePolicy } from '../../lib/cloud/image-policy.ts'
import { addedDocumentImages, documentImages, imageRoots } from './document-images.ts'
import { snapshotEnvelopeBytes, type snapshotCipher } from './snapshot.ts'
import { cloudSnapshots } from './supabase.ts'

export const checkpointFields = 'id,version_name,created_at'

export class CheckpointFailure extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

function objectPath(page: string, version: string) {
  return page + '/versions/' + version + '.bin'
}

type Cipher = ReturnType<typeof snapshotCipher>

export async function readCheckpoint(admin: SupabaseClient, encryption: Cipher, page: string, version: string, limit: number) {
  const { data, error } = await admin.storage.from('documents').download(objectPath(page, version))
  if (error) throw error
  if (data.size > limit + snapshotEnvelopeBytes) throw new CheckpointFailure(413, 'checkpoint_too_large')
  const snapshot = encryption.open(new Uint8Array(await data.arrayBuffer()), 'checkpoint:' + page + ':' + version)
  if (snapshot.byteLength > limit) throw new CheckpointFailure(413, 'checkpoint_too_large')
  return snapshot
}

async function validateSnapshot(admin: SupabaseClient, encryption: Cipher, page: string, policy: CloudImagePolicy, snapshot: Uint8Array) {
  const doc = new Y.Doc()
  try {
    try {
      Y.applyUpdate(doc, snapshot)
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete snapshot')
    } catch {
      throw new CheckpointFailure(400, 'invalid_checkpoint')
    }
    const submitted = documentImages(imageRoots(doc))
    const empty = { source: new Map<string, number>(), rich: new Map<string, number>() }
    const disallowed = (source: string) => !cloudImageAllowed(source, policy)
    if (![...addedDocumentImages(empty, submitted)].some(disallowed)) return

    const current = new Y.Doc()
    try {
      const saved = await cloudSnapshots(admin, encryption).load(page)
      if (saved) Y.applyUpdate(current, saved)
      if ([...addedDocumentImages(documentImages(imageRoots(current)), submitted)].some(disallowed)) {
        throw new CheckpointFailure(413, 'checkpoint_image_limit')
      }
    } finally {
      current.destroy()
    }
  } finally {
    doc.destroy()
  }
}

export async function storeCheckpoint({ admin, actor, subject, encryption, page, id, name, policy, snapshot, recheck }: {
  admin: SupabaseClient
  actor: SupabaseClient
  subject: string
  encryption: Cipher
  page: string
  id: string
  name: string
  policy: CloudImagePolicy
  snapshot: Uint8Array
  recheck?: () => Promise<void>
}) {
  const existingRecord = () => admin.from('document_versions').select(checkpointFields)
    .eq('page_id', page).eq('id', id).eq('created_by', subject).maybeSingle<Checkpoint>()
  if (recheck) {
    const { data, error } = await existingRecord()
    if (error) throw error
    if (data) return data
  }
  await validateSnapshot(admin, encryption, page, policy, snapshot)
  const path = objectPath(page, id)
  const encrypted = encryption.seal(snapshot, 'checkpoint:' + page + ':' + id)
  const bucket = admin.storage.from('documents')
  const { error: uploadError } = await bucket.upload(path, encrypted, { contentType: 'application/octet-stream', upsert: false })
  if (uploadError) throw uploadError
  try {
    await recheck?.()
    const { data, error } = await actor.from('document_versions').insert({
      id, page_id: page, version_name: name, created_by: subject, storage_path: path,
    }).select(checkpointFields).single<Checkpoint>()
    if (error) throw error
    return data
  } catch (error) {
    const { data: existing, error: readError } = await existingRecord()
    if (existing) return existing
    if (!readError) await bucket.remove([path])
    throw error
  }
}
