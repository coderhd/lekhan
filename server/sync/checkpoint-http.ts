import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authConfig } from '../../lib/auth/config.ts'
import { workspaceEntitlementOrFree } from '../../lib/billing/entitlements.ts'
import { checkpointTransferBytes } from '../../lib/cloud/checkpoints.ts'
import { pageAccess } from '../../lib/cloud/graph.ts'
import { readPageSyncPreference } from '../../lib/sync/preferences.ts'
import { getExpirationCutoffDate } from '../../lib/tier-limits.ts'
import { CheckpointFailure, readCheckpoint, storeCheckpoint } from './checkpoint-store.ts'
import { openCheckpointTransfer } from './checkpoint-ticket.ts'
import type { snapshotCipher } from './snapshot.ts'

async function readSnapshot(request: IncomingMessage) {
  const length = Number(request.headers['content-length'])
  if (length > checkpointTransferBytes) throw new CheckpointFailure(413, 'checkpoint_too_large')
  const chunks: Buffer[] = []
  let count = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    count += chunk.length
    if (count > checkpointTransferBytes) throw new CheckpointFailure(413, 'checkpoint_too_large')
    chunks.push(chunk)
  }
  if (!count) throw new CheckpointFailure(400, 'invalid_checkpoint')
  return Buffer.concat(chunks, count)
}

export function checkpointHttp(admin: SupabaseClient, cipher: ReturnType<typeof snapshotCipher>, origin: string) {
  const writes = new Set<string>()
  let active = 0
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Vary', 'Origin')
    const json = (status: number, body: object) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    if (request.headers.origin !== origin) { json(403, { error: 'origin_denied' }); return }
    response.setHeader('Access-Control-Allow-Origin', origin)
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      }).end()
      return
    }

    const bearer = /^Bearer ([\w-]+)$/.exec(request.headers.authorization ?? '')?.[1]
    const parsed = bearer && openCheckpointTransfer(cipher, bearer)
    if (!parsed || request.method !== parsed.method) { json(401, { error: 'invalid_transfer' }); return }
    const transfer = parsed
    const config = authConfig()
    if (!config || active >= 2 || (transfer.method === 'POST' && writes.has(transfer.version))) {
      json(503, { error: 'checkpoints_unavailable' })
      return
    }
    // Apply the original caller's row policies, including the metadata insert.
    const actor = createClient(config.url, config.publishableKey, { accessToken: async () => transfer.accessToken })
    async function authority() {
      if (Date.now() >= transfer.until) throw new CheckpointFailure(401, 'invalid_transfer')
      const access = await pageAccess(actor, transfer.page, transfer.subject)
      if (!access?.privateAccess) throw new CheckpointFailure(404, 'page_not_found')
      const plan = await workspaceEntitlementOrFree(access.page.workspace_id, admin)
      if (transfer.method === 'POST' && (access.role === 'viewer' || plan?.relayReadOnly ||
        (access.role === 'owner' && (!plan || plan.tier === 'free') && await readPageSyncPreference(admin, transfer.page) === 'paused'))) {
        throw new CheckpointFailure(403, 'read_only')
      }
      return plan
    }
    async function checkVersion() {
      const plan = await authority()
      const { data, error } = await actor.from('document_versions').select('id')
        .eq('page_id', transfer.page).eq('id', transfer.version)
        .gte('created_at', getExpirationCutoffDate(plan?.tier).toISOString()).maybeSingle()
      if (error) throw error
      if (!data) throw new CheckpointFailure(404, 'checkpoint_not_found')
    }

    active++
    if (transfer.method === 'POST') writes.add(transfer.version)
    request.setTimeout(30_000, () => request.destroy())
    try {
      if (transfer.method === 'GET') {
        await checkVersion()
        const bytes = await readCheckpoint(admin, cipher, transfer.page, transfer.version, checkpointTransferBytes)
        await checkVersion()
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.byteLength })
        await new Promise<void>(resolve => {
          response.once('close', resolve)
          response.end(bytes, resolve)
        })
        return
      }
      if (request.headers['content-type'] !== 'application/octet-stream') throw new CheckpointFailure(400, 'invalid_checkpoint')
      await authority()
      const snapshot = await readSnapshot(request)
      const tier = (await authority())?.tier ?? 'free'
      const checkpoint = await storeCheckpoint({
        admin, actor, subject: transfer.subject, encryption: cipher, page: transfer.page,
        id: transfer.version, name: transfer.name, policy: tier === 'free' ? 'free' : 'paid', snapshot,
        recheck: async () => {
          if (((await authority())?.tier ?? 'free') !== tier) throw new CheckpointFailure(409, 'checkpoint_plan_changed')
        },
      })
      json(201, { checkpoint })
    } catch (error) {
      if (response.destroyed || response.headersSent) return
      if (!request.complete) response.setHeader('Connection', 'close')
      if (error instanceof CheckpointFailure) json(error.status, { error: error.code })
      else json(503, { error: 'checkpoints_unavailable' })
    } finally {
      if (transfer.method === 'POST') writes.delete(transfer.version)
      active--
    }
  }
}
