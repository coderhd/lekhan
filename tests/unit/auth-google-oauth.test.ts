import { describe, expect, it } from 'vitest'
import { desktopReturnLink, googleCallback, googleFlowLifetime, readGoogleFlow } from '../../lib/auth/google-oauth'

const id = 'a7aa2b2b-d994-473e-b786-6af810110011'
const other = '85fd0cb0-4cfb-4387-b240-22fee30ce85d'
const origin = 'https://lekhan.example'
const now = 1_795_475_400_000

describe('Google PKCE callback', () => {
  it('uses exact hosted paths and gives the desktop app only the flow ID and code', () => {
    expect(googleCallback(origin, id, false)).toBe(origin + '/auth/confirm?oauth=' + id)
    expect(googleCallback(origin, id, true)).toBe(origin + '/auth/desktop-return?oauth=' + id)
    expect(desktopReturnLink(id, 'fixture.code')).toBe('lekhan://auth/complete?oauth=' + id + '&code=fixture.code')
    expect(desktopReturnLink(id, 'code&next=https://elsewhere.example')).toBe('lekhan://auth/complete?oauth=' + id + '&error=oauth')
    expect(desktopReturnLink([id, other], 'fixture')).toBeNull()
  })

  it('requires the original unexpired flow and retains valid internal continuations', () => {
    const cookie = JSON.stringify({ id, start: now, invite: other, transfer: 'A'.repeat(43) })
    expect(readGoogleFlow(cookie, id, now + 1)).toEqual({ id, start: now, invite: other, transfer: 'A'.repeat(43) })
    expect(readGoogleFlow(cookie, other, now + 1)).toBeNull()
    expect(readGoogleFlow(cookie, id, now - 1)).toBeNull()
    expect(readGoogleFlow(cookie, id, now + googleFlowLifetime * 1000)).toBeNull()
    expect(readGoogleFlow(undefined, id, now)).toBeNull()
  })

  it('drops unauthorized or malformed continuations', () => {
    const cookie = JSON.stringify({ id, start: now, invite: 'https://elsewhere.example', transfer: ['account'] })
    expect(readGoogleFlow(cookie, id, now)).toEqual({ id, start: now, invite: undefined, transfer: undefined })
  })
})
