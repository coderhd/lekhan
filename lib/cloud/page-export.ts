import type { Page } from '../types'
import { safeFilename, workspaceArchiveEntries } from '../workspace-export'
import { workspaceManifestPath } from '../archive-metadata'
import { listCloudAttachments, transferCloudAttachment } from './attachment-client'
import type { CloudAttachment } from './attachments'

export type CloudExportProgress = { completed: number; total: number }

async function listAllFiles(pageId: string, signal: AbortSignal) {
  const files = new Map<string, CloudAttachment>()
  const cursors = new Set<string>()
  let after: string | null | undefined
  do {
    const list = await listCloudAttachments(pageId, signal, after)
    for (const file of list.files) files.set(file.id, file)
    after = list.after
    if (after) {
      if (cursors.has(after)) throw new Error('Attachment list did not advance.')
      cursors.add(after)
    }
  } while (after)
  return [...files.values()]
}

function fileName(name: string, used: Set<string>) {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && /^[a-z0-9]{1,16}$/i.test(name.slice(dot + 1)) ? name.slice(dot) : ''
  const base = safeFilename(extension ? name.slice(0, dot) : name)
  for (let suffix = 1; ; suffix++) {
    const candidate = (suffix === 1 ? base : `${base} (${suffix})`) + extension
    const key = candidate.normalize('NFC').toLowerCase()
    if (!used.has(key)) {
      used.add(key)
      return candidate
    }
  }
}

function completeFile(body: ReadableStream<Uint8Array>, size: number) {
  let received = 0
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > size) throw new Error('Attachment size changed during export.')
      controller.enqueue(chunk)
    },
    flush() {
      if (received !== size) throw new Error('Attachment did not finish downloading.')
    },
  }))
}

export async function writeCloudPageArchive(
  page: Page, output: WritableStream<Uint8Array>, signal: AbortSignal,
  progress: (current: CloudExportProgress) => void,
) {
  const sink = output.getWriter()
  try {
    const files = await listAllFiles(page.id, signal)
    const { ZipWriter, Uint8ArrayReader } = await import('@zip.js/zip.js')
    signal.throwIfAborted()
    const zip = new ZipWriter(new WritableStream<Uint8Array>({ write: chunk => sink.write(chunk) }), {
      level: 0, useWebWorkers: false,
    })
    const entries = workspaceArchiveEntries([{ ...page, parentId: null }])
    // Workbook restoration metadata belongs to the workspace ZIP.
    delete entries[workspaceManifestPath]
    for (const [path, bytes] of Object.entries(entries)) {
      await zip.add(path, new Uint8ArrayReader(bytes), { signal })
    }
    const used = new Set<string>()
    let completed = 0
    progress({ completed, total: files.length })
    for (const file of files) {
      signal.throwIfAborted()
      const response = await transferCloudAttachment(page.id, file.id, { method: 'GET', signal })
      if (!response.body) throw new Error('Attachment has no file data.')
      const input = { readable: completeFile(response.body, file.byte_count), size: file.byte_count }
      await zip.add('Files/' + fileName(file.filename, used), input, { signal })
      progress({ completed: ++completed, total: files.length })
    }
    await zip.close()
    signal.throwIfAborted()
    await sink.close()
  } catch (failure) {
    await sink.abort(failure).catch(() => undefined)
    throw failure
  } finally {
    sink.releaseLock()
  }
}
