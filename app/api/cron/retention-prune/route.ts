import { createServerAdmin } from '@/lib/auth/admin'
import { authorizedCron } from '@/lib/server/cron'
import { pruneExpiredCheckpoints } from '@/server/sync/prune-checkpoints'

export const maxDuration = 300

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  if (!authorizedCron(request)) return Response.json({ error: 'unauthorized' }, { status: 401, headers })
  const admin = createServerAdmin()
  if (!admin) return Response.json({ error: 'retention_unavailable' }, { status: 503, headers })
  try {
    const result = await pruneExpiredCheckpoints(admin)
    return Response.json(result, { status: result.failures || result.deferred ? 503 : 200, headers })
  } catch {
    return Response.json({ error: 'retention_unavailable' }, { status: 503, headers })
  }
}
