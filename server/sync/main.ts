import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
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
import { recordPageImages, reservePageImages } from './media-usage.ts'
import { setPageSyncPreference } from '../../lib/sync/preferences.ts'
import { drainWaitlist } from '../../lib/waitlist/brevo.ts'
import { createRelayFaultReporter, createRelayLogs } from '../../lib/observability/relay-logs.ts'
import { flushObservability, initServerObservability, reportException } from '../../lib/observability/sentry-node.ts'

initServerObservability('relay')
const logs = createRelayLogs()
const reportFault = createRelayFaultReporter((operation, error) => {
  logs.log(operation, 'error')
  reportException(error, operation)
})
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
await mkdir(walDirectory, { recursive: true, mode: 0o700 })
await access(walDirectory, constants.W_OK | constants.X_OK)
const cipher = snapshotCipher(encryptionKey, (process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS ?? '').split(',').map(value => value.trim()).filter(Boolean))
const hub = createSyncHub({
  secret,
  origin,
  wal: encryptedWal(walDirectory, cipher),
  checkpointTransfer: checkpointHttp(client, cipher, origin),
  attachmentTransfer: attachmentHttp(client, cipher, origin, secret),
  ...cloudSnapshots(client, cipher),
  reserveImages: (page, bytes) => reservePageImages(client, [{ page, bytes }]),
  recordImages: (page, bytes) => recordPageImages(client, page, bytes),
  setPageSync: (page, subject, enabled) => setPageSyncPreference(client, page, subject, enabled),
  authorize: (ticket, admission) => relayedPageAccess(client, ticket, admission),
  imagePolicy: async ticket => {
    const { access, imagePolicy, preference } = await relayedPageAuthority(client, ticket, false)
    return access === 'write' && preference !== 'paused' ? imagePolicy : null
  },
  onFault: reportFault,
})

hub.server.listen(port, () => logs.log('listening', 'info'))
let ongoingPrune: Promise<unknown> | undefined
let pruneTimer: ReturnType<typeof setInterval> | undefined
const pruneCheckpoints = process.env.LEKHAN_PRUNE_CHECKPOINTS === '1'
const pruneImportReceipts = process.env.LEKHAN_PRUNE_IMPORT_RECEIPTS === '1'
const prune = () => {
  if (ongoingPrune) return
  const checkpoints = pruneCheckpoints ? pruneExpiredCheckpoints(client).then(({ pruned, failures, deferred }) => {
    if (pruned || failures || deferred) logs.log('checkpoints', failures || deferred ? 'error' : 'info', { pruned, failures, deferred: Number(deferred) })
  }).catch(error => { reportFault('retention', error) }) : null
  const receipts = pruneImportReceipts ? client.rpc('cleanup_import_batches', { retain_days: 30 }).then(({ data, error }) => {
    if (error) reportFault('retention', error)
    else if (data) logs.log('import receipts', 'info', { removed: data })
  }) : null
  const attachments = pruneCheckpoints ? pruneAttachments(client).then(({ removed, failures }) => {
    if (removed || failures) logs.log('attachments', failures ? 'error' : 'info', { removed, failures })
  }).catch(error => { reportFault('retention', error) }) : null
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
  ongoingDelivery = drainWaitlist(client).catch(error => { reportFault('waitlist', error) })
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
    if (!saved) {
      reportFault('shutdown', new Error('Relay shutdown left snapshots pending'))
      process.exitCode = 1
    }
  }).catch(error => {
    reportFault('shutdown', error)
    process.exitCode = 1
  }).finally(() => Promise.all([logs.flush(), flushObservability()]))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
