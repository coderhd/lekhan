import * as Y from 'yjs'
import { fromBase64, toBase64 } from 'lib0/buffer'
import { replaceSourceText } from '../lib/sync/replace-source'

export type NoteSidecar = { key: string; snapshot: string | null; updates: string[] }
export type SidecarWrite = { key: string; data: string; snapshot: boolean }

const MAX_UPDATES = 32
const MAX_INCREMENT_BYTES = 2 * 1024 * 1024

export function openNoteSidecar(sidecar?: NoteSidecar) {
  const document = new Y.Doc()
  try {
    if (sidecar?.snapshot) Y.applyUpdate(document, fromBase64(sidecar.snapshot))
    for (const update of sidecar?.updates ?? []) Y.applyUpdate(document, fromBase64(update))
    return document
  } catch (error) {
    document.destroy()
    throw error
  }
}

export function advanceNoteSidecar(key: string, previous: NoteSidecar | undefined, onDisk: string, next: string) {
  const document = openNoteSidecar(previous)
  try {
    const source = document.getText('source')
    const text = source.toString()
    if (text === onDisk && onDisk === next && previous?.snapshot) return
    const vector = Y.encodeStateVector(document)
    // External Markdown edits join the same history before the writer's delta.
    document.transact(() => replaceSourceText(source, text, onDisk), 'disk')
    document.transact(() => replaceSourceText(source, onDisk, next), 'writer')

    const compact = !previous?.snapshot || previous.updates.length >= MAX_UPDATES ||
      previous.updates.reduce((bytes, update) => bytes + update.length, 0) > MAX_INCREMENT_BYTES
    const data = toBase64(Y.encodeStateAsUpdate(document, compact ? undefined : vector))
    const write: SidecarWrite = { key, data, snapshot: compact }
    const sidecar: NoteSidecar = compact
      ? { key, snapshot: data, updates: [] }
      : { key, snapshot: previous.snapshot, updates: [...previous.updates, data] }
    return { write, sidecar }
  } finally {
    document.destroy()
  }
}
