export const FOUNDING_CAP = 500
export const WAITLIST_RECEIPT = 'lekhan-waitlist-receipt'
export const confirmationToken = /^[a-f0-9]{48}$/

export function waitlistInput(input: Record<string, unknown>) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(email)) return null
  const field = (value: unknown, length: number) => typeof value === 'string' && value.trim()
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, length) || null : null
  return { email, referredBy: field(input.ref, 100), source: field(input.utm_source, 100), purpose: field(input.use_case, 500) }
}
