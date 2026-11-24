import { describe, expect, it } from 'vitest'
import { authSessionCookie, offlineAccount } from '../lib/cloud/offline-account'

const first = '4dbc5892-753d-4be6-9d78-faaeb9bbd2d7'
const second = 'ae84d6dc-d9c6-46b1-9187-fc3634bf88f5'
const name = authSessionCookie('https://project.supabase.co')
const mark = 'lekhan-offline-account=' + encodeURIComponent(first + ':' + name)
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const cookieSession = (subject: string) => 'base64-' + encode({ access_token: 'test.' + encode({ sub: subject, exp: 1 }) + '.test' })

describe('offline account continuity', () => {
  it('accepts only a matching previously verified browser account, even after token expiry', () => {
    expect(offlineAccount(mark + '; ' + name + '=' + cookieSession(first))).toBe(first)
    expect(offlineAccount(mark + '; ' + name + '=' + cookieSession(second))).toBeNull()
    expect(offlineAccount(name + '=' + cookieSession(first))).toBeNull()
    expect(offlineAccount(mark)).toBeNull()
  })

  it('supports chunked Supabase cookies and rejects corrupt session data', () => {
    const session = cookieSession(first)
    expect(offlineAccount(mark + '; ' + name + '.0=' + session.slice(0, 40) + '; ' + name + '.1=' + session.slice(40))).toBe(first)
    expect(offlineAccount(mark + '; ' + name + '.0=' + session.slice(0, 40) + '; ' + name + '.2=' + session.slice(40))).toBeNull()
  })
})
