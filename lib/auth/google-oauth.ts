import { invitationPath, workspaceTransferPath } from './input'

export const googleFlowCookie = 'lekhan_google_oauth'
export const googleFlowLifetime = 15 * 60

const flowId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const oauthCode = /^[a-z0-9_.~-]{1,256}$/i

export function googleOAuthEnabled() {
  return process.env.LEKHAN_GOOGLE_OAUTH === '1'
}

export function googleCallback(origin: string, flow: string, desktop: boolean) {
  const callback = new URL(desktop ? '/auth/desktop-return' : '/auth/confirm', origin)
  callback.searchParams.set('oauth', flow)
  return callback.href
}

interface GoogleFlow {
  id: string
  start: number
  invite?: string
  transfer?: string
}

export function readGoogleFlow(cookie: string | undefined, incoming: string, now = Date.now()): GoogleFlow | null {
  if (!cookie || cookie.length > 300 || !flowId.test(incoming)) return null
  try {
    const { id, start, invite, transfer } = JSON.parse(cookie)
    if (id !== incoming || !Number.isSafeInteger(start) || start > now || now - start >= googleFlowLifetime * 1_000) return null
    return {
      id, start,
      invite: typeof invite === 'string' && invitationPath(invite) ? invite : undefined,
      transfer: typeof transfer === 'string' && workspaceTransferPath(transfer) ? transfer : undefined,
    }
  } catch { return null }
}

export function desktopReturnLink(flow: unknown, code: unknown) {
  if (typeof flow !== 'string' || !flowId.test(flow)) return null
  const target = new URL('lekhan://auth/complete')
  target.searchParams.set('oauth', flow)
  if (typeof code === 'string' && oauthCode.test(code)) target.searchParams.set('code', code)
  else target.searchParams.set('error', 'oauth')
  return target.href
}
