import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { siteOrigin } from '@/lib/auth/config'
import { createAuthClient } from '@/lib/auth/server'
import { invitationPath, readConfirmation, workspaceTransferPath } from '@/lib/auth/input'
import { googleFlowCookie, readGoogleFlow } from '@/lib/auth/google-oauth'
import { recordAnalyticsReceipt } from '@/lib/server/analytics'

export async function GET(request: NextRequest) {
  const origin = siteOrigin() ?? request.nextUrl.origin
  const params = request.nextUrl.searchParams
  const confirmation = readConfirmation(params)
  const client = await createAuthClient()
  const nonce = params.get('oauth')
  let path = nonce !== null ? '/login?error=google' : '/login?error=confirm'

  if (nonce !== null) {
    const store = await cookies()
    const flow = params.getAll('oauth').length === 1 && readGoogleFlow(store.get(googleFlowCookie)?.value, nonce)
    if (flow) {
      store.set(googleFlowCookie, '', { path: '/auth', maxAge: 0 })
      const continuation = new URLSearchParams({
        ...(flow.invite ? { invite: flow.invite } : {}), ...(flow.transfer ? { transfer: flow.transfer } : {}),
      })
      if (continuation.size) path += '&' + continuation
      if (client && confirmation?.method === 'code' && !confirmation.recovery && params.getAll('code').length === 1) {
        const result = await client.auth.exchangeCodeForSession(confirmation.code)
        if (!result.error && result.data.session) {
          path = workspaceTransferPath(flow.transfer) ?? invitationPath(flow.invite) ?? '/workspace'
          if (Date.parse(result.data.user?.created_at ?? '') >= flow.start) await recordAnalyticsReceipt('signupGoogle')
        }
      }
    }
  } else if (client && confirmation) {
    const result = confirmation.method === 'token'
      ? await client.auth.verifyOtp({ token_hash: confirmation.hash, type: confirmation.type })
      : await client.auth.exchangeCodeForSession(confirmation.code)
    if (!result.error) {
      path = confirmation.recovery ? '/reset-password' : invitationPath(request.nextUrl.searchParams.get('invite')) ?? '/workspace'
      if (!confirmation.recovery && result.data.session) await recordAnalyticsReceipt('signup')
    }
  }

  return NextResponse.redirect(new URL(path, origin), {
    status: 303,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  })
}
