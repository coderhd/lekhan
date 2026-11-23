import { siteOrigin } from '../../lib/auth/config.ts'
import { createServerAdmin } from '../../lib/auth/admin.ts'
import { relayedPageAccess, relayedPageAuthority } from '../../lib/sync/authority.ts'
import { getTicketSecret } from '../../lib/sync/ticket.ts'
import { createSyncHub } from './hub.ts'
import { snapshotCipher } from './snapshot.ts'
import { cloudSnapshots } from './supabase.ts'
import { encryptedWal } from './wal.ts'
import { pruneExpiredCheckpoints } from './prune-checkpoints.ts'
import { checkpointHttp } from './checkpoint-http.ts'
import { attachmentHttp } from './attachments-http.ts'
import { pruneAttachments } from './prune-attachments.ts'
import { drainWaitlist } from '../../lib/waitlist/brevo.ts'

const client = createServerAdmin()
const origin = siteOrigin()
const secret = getTicketSecret()
const encryptionKey = process.env.LEKHAN_ENCRYPTION_KEY?.trim()
const walDirectory = process.env.LEKHAN_WAL_DIR?.trim()
if (!client || !origin || !secret || !encryptionKey || !walDirectory) {
  throw new Error('Configure Supabase, the app origin, sync signing and snapshot encryption, and a durable WAL directory.')
}

const port = Number(process.env.PORT || 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sync PORT.')
const cipher = snapshotCipher(encryptionKey, (process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean))
const hub = createSyncHub({
  secret,
  origin,
  wal: encryptedWal(walDirectory, cipher),
  checkpointTransfer: checkpointHttp(client, cipher, origin),
  attachmentTransfer: attachmentHttp(client, cipher, origin, secret),
  ...cloudSnapshots(client, cipher),
  authorize: (ticket, admission) => relayedPageAccess(client, ticket, admission),
  imagePolicy: async ticket => {
    const { access, imagePolicy } = await relayedPageAuthority(client, ticket, false)
    return access === 'write' ? imagePolicy : null
  },
  onFault: operation => console.error('[sync] ' + operation + ' failed'),
})

hub.server.listen(port, () => console.log('[sync] listening on port ' + port))
let ongoingPrune: Promise<unknown> | undefined
let pruneTimer: ReturnType<typeof setInterval> | undefined
const pruneCheckpoints = process.env.LEKHAN_PRUNE_CHECKPOINTS === '1'
const pruneImportReceipts = process.env.LEKHAN_PRUNE_IMPORT_RECEIPTS === '1'
const prune = () => {
  if (ongoingPrune) return
  const checkpoints = pruneCheckpoints ? pruneExpiredCheckpoints(client).then(({ pruned, failures, deferred }) => {
    if (pruned || failures || deferred) console.log('[checkpoints] pruned=' + pruned + ' failures=' + failures + ' deferred=' + deferred)
  }).catch(() => { console.error('[checkpoints] retention failed') }) : null
  const receipts = pruneImportReceipts ? client.rpc('cleanup_import_batches', { retain_days: 30 }).then(({ data, error }) => {
    if (error) console.error('[imports] receipt retention failed')
    else if (data) console.log('[imports] removed receipts=' + data)
  }) : null
  const attachments = pruneCheckpoints ? pruneAttachments(client).then(({ removed, failures }) => {
    if (removed || failures) console.log('[attachments] removed=' + removed + ' failures=' + failures)
  }).catch(() => { console.error('[attachments] cleanup failed') }) : null
  ongoingPrune = Promise.allSettled([checkpoints, receipts, attachments]).finally(() => { ongoingPrune = undefined })
}
if (pruneCheckpoints || pruneImportReceipts) {
  prune()
  pruneTimer = setInterval(prune, 6 * 60 * 60 * 1000)
  pruneTimer.unref()
}

let waitlistTimer: ReturnType<typeof setInterval> | undefined
let ongoingDelivery: Promise<void> | undefined
const deliverWaitlist = () => {
  if (ongoingDelivery) return
  ongoingDelivery = drainWaitlist(client).catch(() => { console.error('[waitlist] delivery drain failed') })
    .finally(() => { ongoingDelivery = undefined })
}
if (process.env.LEKHAN_DRAIN_WAITLIST === '1') {
  deliverWaitlist()
  waitlistTimer = setInterval(deliverWaitlist, 60_000)
  waitlistTimer.unref()
}

let terminating = false
function shutdown() {
  if (terminating) return
  terminating = true
  if (pruneTimer) clearInterval(pruneTimer)
  if (waitlistTimer) clearInterval(waitlistTimer)
  void Promise.all([hub.close(), ongoingPrune, ongoingDelivery]).then(([saved]) => {
    if (!saved) process.exitCode = 1
  }).catch(() => { process.exitCode = 1 })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
