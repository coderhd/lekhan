import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmationToken, FOUNDING_CAP } from './input.ts'
import { siteOrigin } from '../auth/config.ts'

export interface WaitlistJob {
  id: number
  kind: 'rebuild_contact' | 'rebuild_founding' | 'rebuild_confirmation'
  email: string
  position: number
  attempts: number
  payload: { token?: string }
}

interface BrevoConfig {
  key: string
  sender: string
  listId: number
  origin: string
}

export function brevoConfig(): BrevoConfig | null {
  const key = process.env.BREVO_API_KEY?.trim()
  const sender = process.env.WAITLIST_CONFIRM_FROM?.trim()
  const listId = Number(process.env.BREVO_FOUNDING_LIST_ID)
  const origin = siteOrigin()
  return key && sender && origin && Number.isSafeInteger(listId) && listId > 0 ? { key, sender, listId, origin } : null
}

export async function deliverWaitlistJob(job: WaitlistJob, config: BrevoConfig, send: typeof fetch = fetch) {
  const confirmation = job.kind === 'rebuild_confirmation'
  let body: Record<string, unknown>
  if (confirmation) {
    const token = job.payload.token
    if (!token || !confirmationToken.test(token)) throw new Error('invalid_confirmation')
    const url = new URL('/early/confirm', config.origin)
    url.searchParams.set('token', token)
    const hex = createHash('sha256').update('lekhan:waitlist:confirmation:' + job.id + ':' + token).digest('hex')
    const key = [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-')
    body = {
      sender: { name: 'Lekhan', email: config.sender }, to: [{ email: job.email }],
      subject: 'Confirm your Lekhan early-access request', headers: { idempotencyKey: key },
      tags: ['founding_waitlist'],
      textContent: (job.position <= FOUNDING_CAP ? 'Your founding cohort spot is #' + job.position + ' of 500.\n\n' : 'Your waitlist position is #' + job.position + '.\n\n')
        + 'Confirm your email within 48 hours: ' + url.href + '\n\nIf you did not request early access, you can ignore this message.',
    }
  } else {
    body = { email: job.email, updateEnabled: true, ...(job.kind === 'rebuild_founding' ? { listIds: [config.listId] } : {}) }
  }

  const response = await send('https://api.brevo.com/v3/' + (confirmation ? 'smtp/email' : 'contacts'), {
    method: 'POST', headers: { 'api-key': config.key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  })
  if (response.ok) return
  if (confirmation && response.status === 400) {
    const failure = await response.json().catch(() => null)
    if (failure?.code === 'duplicate_parameter' && /idempotenc/i.test(failure.message ?? '')) return
  }
  throw new Error('brevo_' + response.status)
}

export async function drainWaitlist(admin: SupabaseClient) {
  const config = brevoConfig()
  if (!config) return
  const lease = randomUUID()
  const { data, error } = await admin.rpc('rebuild_claim_waitlist_jobs', { lease, batch: 8 })
  if (error || !Array.isArray(data)) throw new Error('waitlist_claim_failed')
  for (const job of data as WaitlistJob[]) {
    let update: Record<string, unknown>
    try {
      await deliverWaitlistJob(job, config)
      update = { synced_at: new Date().toISOString(), payload: {}, last_error: null }
    } catch (failure) {
      const delay = Math.min(60 * 60, 15 * 2 ** Math.min(job.attempts, 8))
      update = {
        last_error: failure instanceof Error && /^brevo_\d+$/.test(failure.message) ? failure.message : 'delivery_failed',
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      }
    }
    const result = await admin.from('brevo_outbox').update({ ...update, lease_id: null, lease_until: null }).eq('id', job.id).eq('lease_id', lease)
    if (result.error) throw new Error('waitlist_delivery_record_failed')
  }
}
