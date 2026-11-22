import { type NextRequest, NextResponse } from 'next/server'
import { siteOrigin } from '@/lib/auth/config'
import { createAuthClient } from '@/lib/auth/server'
import { invitationPath, readConfirmation } from '@/lib/auth/input'
import { recordAnalyticsReceipt } from '@/lib/server/analytics'

export async function GET(request: NextRequest) {
  const origin = siteOrigin() ?? request.nextUrl.origin
  const confirmation = readConfirmation(request.nextUrl.searchParams)
  const client = await createAuthClient()
  let path = '/login?error=confirm'

  if (client && confirmation) {
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
