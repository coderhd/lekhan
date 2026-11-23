import { acceptWorkspaceOwner, inviteWorkspaceOwner } from '@/lib/billing/ownership-transfer'
import { workspaceTransferPath } from '@/lib/auth/input'
import { BillingError, billingAccount } from '@/lib/billing/workspace'
import { readBoundedBody } from '@/lib/server/read-body'

function respond(value: object, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  try {
    const context = await billingAccount()
    if (request.headers.get('origin') !== context.origin) return respond({ error: 'invalid_origin' }, 403)
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return respond({ error: 'invalid_request' }, 415)
    }
    const body = await readBoundedBody(request, 1024).catch(() => null)
    const input = body && JSON.parse(body.toString('utf8'))
    if (input?.action === 'invite' && typeof input.email === 'string') {
      const email = input.email.trim()
      if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond(await inviteWorkspaceOwner(context, email))
      }
    }
    if (input?.action === 'accept' && typeof input.token === 'string' && workspaceTransferPath(input.token)) {
      await acceptWorkspaceOwner(context, input.token)
      return respond({ accepted: true })
    }
    return respond({ error: 'invalid_request' }, 400)
  } catch (error) {
    if (error instanceof SyntaxError) return respond({ error: 'invalid_request' }, 400)
    if (error instanceof BillingError) return respond({ error: error.code }, error.status)
    return respond({ error: 'billing_unavailable' }, 503)
  }
}
