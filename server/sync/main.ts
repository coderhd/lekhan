import { siteOrigin } from '../../lib/auth/config.ts'
import { createServerAdmin } from '../../lib/auth/admin.ts'
import { relayedPageAccess } from '../../lib/sync/authority.ts'
import { getTicketSecret } from '../../lib/sync/ticket.ts'
import { createSyncHub } from './hub.ts'
import { snapshotCipher } from './snapshot.ts'
import { cloudSnapshots } from './supabase.ts'
import { encryptedWal } from './wal.ts'
import { pruneExpiredCheckpoints } from './prune-checkpoints.ts'

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
  ...cloudSnapshots(client, cipher),
  authorize: (ticket, admission) => relayedPageAccess(client, ticket, admission),
  onFault: operation => console.error('[sync] ' + operation + ' failed'),
})

hub.server.listen(port, () => console.log('[sync] listening on port ' + port))
let ongoingPrune: Promise<unknown> | undefined
let pruneTimer: ReturnType<typeof setInterval> | undefined
const prune = () => {
  if (ongoingPrune) return
  ongoingPrune = pruneExpiredCheckpoints(client).then(({ pruned, failures }) => {
    if (pruned || failures) console.log('[checkpoints] pruned=' + pruned + ' failures=' + failures)
  }).catch(() => { console.error('[checkpoints] retention failed') }).finally(() => { ongoingPrune = undefined })
}
if (process.env.LEKHAN_PRUNE_CHECKPOINTS === '1') {
  prune()
  pruneTimer = setInterval(prune, 6 * 60 * 60 * 1000)
  pruneTimer.unref()
}

let terminating = false
function shutdown() {
  if (terminating) return
  terminating = true
  if (pruneTimer) clearInterval(pruneTimer)
  void Promise.all([hub.close(), ongoingPrune]).then(([saved]) => {
    if (!saved) process.exitCode = 1
  }).catch(() => { process.exitCode = 1 })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
