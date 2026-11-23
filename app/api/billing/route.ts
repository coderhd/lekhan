import { readBoundedBody } from '@/lib/server/read-body'
import { readOffer } from '@/lib/billing/catalog'
import { refreshWorkspaceCheckout } from '@/lib/billing/reconciliation'
import { BillingError, beginCheckout, billingAccount, manageBilling, ownerWorkspace, readBillingSummary } from '@/lib/billing/workspace'

const headers = { 'Cache-Control': 'private, no-store' }

function respond(value: object, status = 200) {
  return Response.json(value, { status, headers })
}

function failure(error: unknown) {
  if (error instanceof BillingError) return respond({ error: error.code }, error.status)
  return respond({ error: 'billing_unavailable' }, 503)
}

export async function GET() {
  try {
    const { account, admin } = await billingAccount()
    return respond(await readBillingSummary(admin, await ownerWorkspace(account.client, account.subject)))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request) {
  try {
    const context = await billingAccount()
    if (request.headers.get('origin') !== context.origin) return respond({ error: 'invalid_origin' }, 403)
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return respond({ error: 'invalid_request' }, 415)
    let input: Record<string, unknown>
    try {
      const raw = await readBoundedBody(request, 2048)
      if (!raw) return respond({ error: 'invalid_request' }, 400)
      input = JSON.parse(raw.toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input)) return respond({ error: 'invalid_request' }, 400)
    } catch {
      return respond({ error: 'invalid_request' }, 400)
    }

    if (input.action === 'portal' || input.action === 'cancel') return respond({ url: await manageBilling(context, input.action) })
    if (input.action === 'check') return respond({ result: await refreshWorkspaceCheckout(context) })
    if (input.action !== 'checkout') return respond({ error: 'invalid_request' }, 400)
    const offer = readOffer(input)
    if (!offer) return respond({ error: 'invalid_offer' }, 400)
    return respond({ url: await beginCheckout(context, offer) })
  } catch (error) {
    return failure(error)
  }
}
