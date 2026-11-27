import { createServerAdmin } from '@/lib/auth/admin'
import { authorizedCron } from '@/lib/server/cron'
import { pruneExpiredCheckpoints } from '@/server/sync/prune-checkpoints'
import { pruneAttachments } from '@/server/sync/prune-attachments'
import { observeRetention } from '@/lib/observability/sentry-node'

export const maxDuration = 300

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  if (!authorizedCron(request)) return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  return observeRetention(prune)
}

async function prune() {
  const admin = createServerAdmin()
  if (!admin) return Response.json({ error: 'retention_unavailable' }, { status: 503, headers })
  try {
    const [result, attachments] = await Promise.all([pruneExpiredCheckpoints(admin), pruneAttachments(admin)])
    return Response.json({ ...result, attachments }, { status: result.failures || result.deferred || attachments.failures ? 503 : 200, headers })
  } catch {
    return Response.json({ error: 'retention_unavailable' }, { status: 503, headers })
  }
}
