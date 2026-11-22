import { describe, expect, it, vi } from 'vitest'
import { waitlistInput } from '../lib/waitlist/input'
import { readWaitlistReceipt, waitlistReceipt } from '../lib/waitlist/receipt'
import { deliverWaitlistJob, type WaitlistJob } from '../lib/waitlist/brevo'

const secret = 'a fixture secret at least thirty-two characters long'
const config = { key: 'fixture', sender: 'early@example.test', listId: 7, origin: 'http://127.0.0.1:3323' }
const job: WaitlistJob = {
  id: 1, kind: 'rebuild_confirmation', email: 'reader@example.test', position: 501, attempts: 1,
  payload: { token: 'a'.repeat(48) },
}

describe('early-access waitlist', () => {
  it('normalizes addresses and keeps the campaign and referral distinct', () => {
    expect(waitlistInput({ email: ' R@Example.test ', ref: ' x ', utm_source: 'newsletter', use_case: '\0Study' }))
      .toEqual({ email: 'r@example.test', referredBy: 'x', source: 'newsletter', purpose: 'Study' })
    expect(waitlistInput({ email: 'contact@invalid' })).toBeNull()
  })

  it('rejects forged and expired receipts and only gives new signups an event key', () => {
    const receipt = waitlistReceipt(secret, 7, true, 1000)
    expect(readWaitlistReceipt(secret, receipt, 1001)).toMatchObject({ position: 7, event: expect.any(String) })
    expect(readWaitlistReceipt(secret, receipt, 1600)).toBeNull()
    expect(readWaitlistReceipt('different receipt key', receipt, 1001)).toBeNull()
    expect(readWaitlistReceipt(secret, waitlistReceipt(secret, 7, false, 1000), 1001)).toEqual({ position: 7, event: null })
  })

  it('keeps retries idempotent and enrolls contacts only for confirmed founding places', async () => {
    const send = vi.fn().mockResolvedValue(Response.json({}, { status: 201 }))
    await deliverWaitlistJob(job, config, send as unknown as typeof fetch)
    const email = JSON.parse(send.mock.calls[0][1].body)
    expect(email.textContent).toContain('Your waitlist position is #501')
    expect(email.textContent).toContain('/early/confirm?token=' + job.payload.token)
    expect(email.textContent).not.toContain('of 500')

    send.mockResolvedValueOnce(Response.json({ code: 'duplicate_parameter', message: 'Idempotency key already used' }, { status: 400 }))
    await expect(deliverWaitlistJob({ ...job, attempts: 2 }, config, send as unknown as typeof fetch)).resolves.toBeUndefined()
    expect(JSON.parse(send.mock.calls[1][1].body).headers.idempotencyKey).toBe(email.headers.idempotencyKey)

    await deliverWaitlistJob({ ...job, kind: 'rebuild_contact' }, config, send as unknown as typeof fetch)
    expect(JSON.parse(send.mock.calls[2][1].body)).toEqual({ email: job.email, updateEnabled: true })
    await deliverWaitlistJob({ ...job, position: 15, kind: 'rebuild_founding' }, config, send as unknown as typeof fetch)
    expect(JSON.parse(send.mock.calls[3][1].body)).toEqual({ email: job.email, updateEnabled: true, listIds: [7] })
  })
})
