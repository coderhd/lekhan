import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attachmentName, attachmentPartBytes, attachmentPaths, FREE_ATTACHMENT_BYTES, PAID_ATTACHMENT_BYTES, type CloudAttachment } from '../../lib/cloud/attachments.ts'
import { uuidPattern } from '../../lib/cloud/graph.ts'
import { relayedPageAuthority } from '../../lib/sync/authority.ts'
import { verifySyncTicket } from '../../lib/sync/ticket.ts'
import { snapshotEnvelopeBytes, type snapshotCipher } from './snapshot.ts'
import { uploadDocumentObject } from './storage-capacity.ts'

async function uploadBody(request: IncomingMessage, length: number) {
  const bytes = Buffer.alloc(length)
  let received = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    if (received + chunk.length > length) return null
    chunk.copy(bytes, received)
    received += chunk.length
  }
  return received === length ? bytes : null
}

function requestedName(header: string | string[] | undefined) {
  try { return typeof header === 'string' ? attachmentName(decodeURIComponent(header)) : null } catch { return null }
}

export function attachmentHttp(admin: SupabaseClient, cipher: ReturnType<typeof snapshotCipher>, origin: string, secret: string) {
  let transfers = 0
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Vary', 'Origin')
    const fail = (status: number, error: string) => {
      if (!request.complete) response.setHeader('Connection', 'close')
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }))
    }
    if (request.headers.origin !== origin) return fail(403, 'origin_denied')
    response.setHeader('Access-Control-Allow-Origin', origin)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lekhan-Filename, X-Lekhan-Bytes',
      }).end()
      return
    }
    const [, route, page, id, extra] = (request.url ?? '').split('/')
    const bearer = /^Bearer ([\w.-]+)$/.exec(request.headers.authorization ?? '')?.[1]
    const ticket = page && bearer && verifySyncTicket(secret, bearer, page)
    if (!ticket || route !== 'attachments' || !uuidPattern.test(id ?? '') || extra !== undefined) return fail(401, 'invalid_transfer')
    if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'invalid_method')
    if (transfers >= 2) return fail(503, 'attachments_unavailable')
    transfers++
    request.setTimeout(30_000, () => request.destroy())
    try {
      const currentAccess = () => relayedPageAuthority(admin, ticket, false)
      const authority = await currentAccess()
      if (!authority.access) return fail(404, 'attachment_not_found')
      if (request.method === 'GET') {
        const { data, error } = await admin.from('rebuild_cloud_attachments').select('id,filename,byte_count')
          .eq('page_id', page).eq('id', id).eq('state', 'ready').maybeSingle<CloudAttachment>()
        if (error) throw error
        if (!data) return fail(404, 'attachment_not_found')
        const bytes = Buffer.alloc(data.byte_count)
        let offset = 0
        const paths = attachmentPaths(page, id, data.byte_count)
        for (const [index, path] of paths.entries()) {
          const { data: part, error: failure } = await admin.storage.from('documents').download(path)
          if (failure) throw failure
          const count = Math.min(attachmentPartBytes, bytes.length - offset)
          if (part.size !== count + snapshotEnvelopeBytes) throw new Error('Invalid attachment part size.')
          const raw = cipher.open(new Uint8Array(await part.arrayBuffer()), `attachment:${page}:${id}:${index}`, false)
          bytes.set(raw, offset)
          offset += raw.byteLength
        }
        if (!verifySyncTicket(secret, bearer, page) || !(await currentAccess()).access) return fail(404, 'attachment_not_found')
        const latest = await admin.from('rebuild_cloud_attachments').select('id')
          .eq('page_id', page).eq('id', id).eq('state', 'ready').maybeSingle()
        if (latest.error) throw latest.error
        if (!latest.data) return fail(404, 'attachment_not_found')
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(data.filename).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16)) })
        await new Promise<void>(resolve => { response.once('close', resolve); response.end(bytes, resolve) })
        return
      }
      if (authority.access !== 'write' || authority.preference === 'paused') return fail(403, 'read_only')
      const declared = request.headers['x-lekhan-bytes'] ?? request.headers['content-length']
      const length = typeof declared === 'string' && /^\d+$/.test(declared) ? Number(declared) : 0
      const filename = requestedName(request.headers['x-lekhan-filename'])
      if (!filename || !Number.isSafeInteger(length) || length <= 0 || request.headers['content-type'] !== 'application/octet-stream' ||
        (request.headers['content-length'] !== undefined && Number(request.headers['content-length']) !== length)) {
        return fail(400, 'invalid_file')
      }
      if (length > (authority.imagePolicy === 'free' ? FREE_ATTACHMENT_BYTES : PAID_ATTACHMENT_BYTES)) return fail(413, 'file_limit')
      const bytes = await uploadBody(request, length)
      if (!bytes) return fail(400, 'invalid_file')
      if (!verifySyncTicket(secret, bearer, page)) return fail(401, 'invalid_transfer')
      const uploadAccess = await currentAccess()
      if (uploadAccess.access !== 'write' || uploadAccess.preference === 'paused') return fail(403, 'read_only')
      const reservation = await admin.rpc('rebuild_reserve_attachment', {
        target_page: page, actor: ticket.subject, attachment: id, name: filename, file_bytes: length,
      })
      if (reservation.error) throw reservation.error
      const decision = reservation.data
      if (decision === 'denied') return fail(403, 'read_only')
      if (decision === 'file_limit' || decision === 'workspace_limit') return fail(413, decision)
      if (decision !== 'pending' && decision !== 'ready') return fail(409, 'attachments_unavailable')
      if (decision === 'pending') {
        for (const [index, path] of attachmentPaths(page, id, length).entries()) {
          const start = index * attachmentPartBytes
          const part = cipher.seal(bytes.subarray(start, start + attachmentPartBytes), `attachment:${page}:${id}:${index}`)
          if (await uploadDocumentObject(admin, path, part, false) !== 'uploaded') throw new Error('Attachment part already exists.')
        }
        const result = await admin.rpc('rebuild_finish_attachment', { target_page: page, actor: ticket.subject, attachment: id })
        if (result.error) throw result.error
        if (!result.data) return fail(403, 'read_only')
      }
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, filename, byte_count: length }))
    } catch {
      if (!response.headersSent && !response.destroyed) fail(503, 'attachments_unavailable')
    } finally {
      transfers--
    }
  }
}
