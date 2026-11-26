import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const lifetime = 10 * 60

export function receiptSecret() {
  const value = process.env.LEKHAN_WAITLIST_RECEIPT_SECRET?.trim()
  return value && value.length >= 32 ? value : null
}

export function waitlistReceipt(secret: string, position: number, created: boolean, now = Math.floor(Date.now() / 1000)) {
  const data = Buffer.from(JSON.stringify({ position, event: created ? randomUUID() : null, expires: now + lifetime })).toString('base64url')
  return data + '.' + sign(secret, data).toString('base64url')
}

function sign(secret: string, data: string) {
  return createHmac('sha256', secret).update('lekhan:waitlist-receipt:v1:' + data).digest()
}

export function readWaitlistReceipt(secret: string, value: string, now = Math.floor(Date.now() / 1000)) {
  if (value.length > 420 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null
  const [data, proof] = value.split('.')
  const actual = Buffer.from(proof, 'base64url')
  const expected = sign(secret, data)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const { position, expires, event } = JSON.parse(Buffer.from(data, 'base64url').toString())
    return Number.isSafeInteger(position) && position > 0 && Number.isSafeInteger(expires) && now < expires
      && expires <= now + lifetime && (event === null || typeof event === 'string') ? { position: position as number, event: event as string | null } : null
  } catch { return null }
}
