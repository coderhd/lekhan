import type { CloudAttachment } from './attachments'

const transferErrors = {
  accessUnverified: 'Could not verify access to this page.',
  transferUnavailable: 'The file transfer is unavailable.',
  storagePending: 'Cloud storage is still checking the previous transfer. Wait up to 10 minutes, then resume the import.',
  workspaceLimit: 'This workspace has reached its file storage limit.',
  fileLimit: 'This file exceeds the workspace’s current per-file limit.',
  accessChanged: 'Access to this file or page changed.',
  transferFailed: 'The file transfer could not finish. Try again.',
  attachmentsUnavailable: 'Could not load attachments.',
} as const

export class AttachmentTransferError extends Error {
  constructor(readonly code: keyof typeof transferErrors) { super(transferErrors[code]) }
}

export interface CloudAttachmentList {
  files: CloudAttachment[]
  after: string | null
  writable: boolean
  canRemove: boolean
  maxBytes: number
}

export async function transferCloudAttachment(pageId: string, id: string, options: RequestInit, account?: string) {
  const params = new URLSearchParams({ pageId })
  if (account) params.set('account', account)
  if (options.method === 'GET') params.set('transfer', 'attachment')
  const session = await fetch('/api/sync/session?' + params, { cache: 'no-store', signal: options.signal })
  if (!session.ok) throw new AttachmentTransferError('accessUnverified')
  const { endpoint, ticket } = await session.json()
  if (typeof ticket !== 'string' || typeof endpoint !== 'string') throw new AttachmentTransferError('transferUnavailable')
  const url = new URL(endpoint)
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new AttachmentTransferError('transferUnavailable')
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.search = ''
  url.hash = ''
  url.pathname = `/attachments/${pageId}/${id}`
  const reply = await fetch(url, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + ticket }, credentials: 'omit',
    cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
  })
  if (reply.ok) return reply
  const body = await reply.json().catch(() => null)
  if (body?.error === 'import_attachment_pending') throw new AttachmentTransferError('storagePending')
  if (body?.error === 'workspace_limit') throw new AttachmentTransferError('workspaceLimit')
  if (body?.error === 'file_limit') throw new AttachmentTransferError('fileLimit')
  if (reply.status === 403 || reply.status === 404) throw new AttachmentTransferError('accessChanged')
  throw new AttachmentTransferError('transferFailed')
}

export async function listCloudAttachments(pageId: string, signal: AbortSignal, after?: string | null): Promise<CloudAttachmentList> {
  const params = new URLSearchParams({ pageId })
  if (after) params.set('after', after)
  const reply = await fetch('/api/attachments?' + params, { signal, cache: 'no-store' })
  if (!reply.ok) throw new AttachmentTransferError('attachmentsUnavailable')
  return reply.json()
}

export async function uploadImportedAttachment(pageId: string, file: {
  id: string; filename: string; data: Uint8Array; digest: string
}, account: string | undefined, signal?: AbortSignal) {
  const reply = await transferCloudAttachment(pageId, file.id, {
    method: 'POST',
    signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Lekhan-Filename': encodeURIComponent(file.filename),
      'X-Lekhan-Bytes': String(file.data.byteLength),
      'X-Lekhan-SHA256': file.digest,
    },
    body: new Uint8Array(file.data),
  }, account)
  const saved: CloudAttachment & { replayed?: boolean } = await reply.json()
  if (saved.id !== file.id || saved.filename !== file.filename || saved.byte_count !== file.data.byteLength) {
    throw new Error('The attachment upload did not return a matching receipt.')
  }
  return saved.replayed === true
}

export function transferredFilename(reply: Response) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(reply.headers.get('content-disposition') ?? '')
  if (match) {
    try {
      const filename = decodeURIComponent(match[1])
      if (filename && !/[\/\\\u0000-\u001f\u007f]/.test(filename)) return filename
    } catch { /* Use a generic name for an invalid download header. */ }
  }
  return 'Attachment'
}
