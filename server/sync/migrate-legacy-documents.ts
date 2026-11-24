import { createServerAdmin } from '../../lib/auth/admin.ts'
import { uuidPattern } from '../../lib/cloud/graph.ts'

interface CutoverBatch {
  lastDocument: string | null
  scanned: number
  createdPages: number
  movedCheckpoints: number
  copiedInvitations: number
  retainedCutovers: number
  conflicts: { document: string; reason: string }[]
}

function isCutoverBatch(value: unknown): value is CutoverBatch {
  if (!value || typeof value !== 'object') return false
  const batch = value as Partial<CutoverBatch>
  return [batch.scanned, batch.createdPages, batch.movedCheckpoints, batch.copiedInvitations, batch.retainedCutovers]
    .every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    && (batch.lastDocument === null || (typeof batch.lastDocument === 'string' && uuidPattern.test(batch.lastDocument)))
    && Array.isArray(batch.conflicts)
}

const flags = process.argv.slice(2)
if (flags.includes('--help')) {
  console.log('Usage: migrate-legacy-documents.ts [--apply] [--after=<document UUID>] [--batch-size=<1–100>]')
  console.log('Runs a read-only scan by default. Use --apply to commit one batch at a time.')
  process.exit(0)
}

const apply = flags.includes('--apply')
const batchSize = Number(flags.find(flag => flag.startsWith('--batch-size='))?.slice('--batch-size='.length) ?? 25)
let after = flags.find(flag => flag.startsWith('--after='))?.slice('--after='.length).toLowerCase() ?? null
if (flags.some(flag => flag !== '--apply' && !flag.startsWith('--after=') && !flag.startsWith('--batch-size=')) ||
  (after !== null && !uuidPattern.test(after)) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
  throw new Error('Invalid cutover arguments. Run with --help for usage.')
}

const admin = createServerAdmin()
if (!admin) throw new Error('Configure the Supabase URL, publishable key, and server-only credential before running the cutover.')
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', origin: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin, after }))
const totals = { scanned: 0, createdPages: 0, movedCheckpoints: 0, copiedInvitations: 0, retainedCutovers: 0, conflicts: 0 }

for (;;) {
  const { data, error } = await admin.rpc('rebuild_migrate_legacy_documents', {
    after_document: after, batch_limit: batchSize, apply_changes: apply,
  })
  if (error) throw new Error('Legacy cutover batch failed. The last printed cursor is safe to resume from.', { cause: error })
  if (!isCutoverBatch(data) || data.scanned > batchSize ||
    (data.scanned > 0 && (!data.lastDocument || (after !== null && data.lastDocument <= after)))) {
    throw new Error('Invalid legacy cutover receipt.')
  }
  if (!data.scanned) break
  totals.scanned += data.scanned
  totals.createdPages += data.createdPages
  totals.movedCheckpoints += data.movedCheckpoints
  totals.copiedInvitations += data.copiedInvitations
  totals.retainedCutovers += data.retainedCutovers
  totals.conflicts += data.conflicts.length
  console.log(JSON.stringify(data))
  after = data.lastDocument
  if (data.scanned < batchSize) break
}

console.log(JSON.stringify({ totals }))
if (totals.conflicts) process.exitCode = 2
