import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PageRole } from '../cloud/graph'

export { syncProtocol } from './wire.ts'
export const ticketLifetime = 5 * 60

export interface SyncTicket {
  pageId: string
  subject: string
  role: PageRole
  exp: number
}

export function getTicketSecret() {
  const value = process.env.LEKHAN_SYNC_TICKET_SECRET?.trim()
  return value && value.length >= 32 ? value : null
}

const audience = 'lekhan.sync.ticket.v1'
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function issueSyncTicket(
  secret: string,
  claims: Omit<SyncTicket, 'exp'>,
  now = Math.floor(Date.now() / 1000),
) {
  const proof = Buffer.from(JSON.stringify({ aud: audience, ...claims, exp: now + ticketLifetime })).toString('base64url')
  const signature = createHmac('sha256', secret).update(proof).digest('base64url')
  return proof + '.' + signature
}

export function verifySyncTicket(
  secret: string,
  ticket: string,
  pageId: string,
  now = Math.floor(Date.now() / 1000),
): SyncTicket | null {
  if (ticket.length > 768 || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(ticket)) return null
  const [proof, signature] = ticket.split('.')
  const expected = createHmac('sha256', secret).update(proof).digest()
  const signer = Buffer.from(signature, 'base64url')
  if (signer.length !== expected.length || !timingSafeEqual(signer, expected)) return null

  try {
    const data = JSON.parse(Buffer.from(proof, 'base64url').toString('utf8'))
    if (data.aud !== audience || data.pageId !== pageId || !uuid.test(pageId) ||
      typeof data.subject !== 'string' || !uuid.test(data.subject) ||
      !['owner', 'editor', 'viewer'].includes(data.role) ||
      !Number.isSafeInteger(data.exp) || data.exp <= now || data.exp > now + ticketLifetime) return null
    return { pageId, subject: data.subject, role: data.role, exp: data.exp }
  } catch {
    return null
  }
}
