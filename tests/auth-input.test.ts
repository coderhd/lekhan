import { afterEach, describe, expect, it, vi } from 'vitest'
import { authConfig, confirmationTarget, siteOrigin } from '../lib/auth/config'
import { billingNextPath, readConfirmation, readCredentials, workspaceTransferPath } from '../lib/auth/input'

afterEach(() => vi.unstubAllEnvs())

describe('authentication input', () => {
  it('uses only a configured safe origin and publishable key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.example')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_example')
    expect(authConfig()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture')
    expect(authConfig()).toEqual({ url: 'https://project.example', publishableKey: 'sb_publishable_fixture' })
    vi.stubEnv('LEKHAN_PUBLIC_URL', 'https://lekhan.example')
    expect(confirmationTarget('recovery')).toBe('https://lekhan.example/auth/confirm?flow=recovery')
    vi.stubEnv('LEKHAN_PUBLIC_URL', 'https://host.example@other.example')
    expect(confirmationTarget('email')).toBeNull()
  })

  it('processes only supported verification methods and ignores redirect targets', () => {
    expect(readConfirmation(new URLSearchParams('token_hash=example&type=recovery&next=//elsewhere.example')))
      .toEqual({ method: 'token', hash: 'example', type: 'recovery', recovery: true })
    expect(readConfirmation(new URLSearchParams('code=example&flow=recovery')))
      .toEqual({ method: 'code', code: 'example', recovery: true })
    expect(readConfirmation(new URLSearchParams('token_hash=example&type=magiclink'))).toBeNull()
  })

  it('uses the generated Vercel origin only on opted-in previews without an explicit origin', () => {
    vi.stubEnv('LEKHAN_PUBLIC_URL', undefined)
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'lekhan-staging-test.vercel.app')
    vi.stubEnv('LEKHAN_USE_VERCEL_PREVIEW_ORIGIN', undefined)
    expect(siteOrigin()).toBeNull()
    vi.stubEnv('LEKHAN_USE_VERCEL_PREVIEW_ORIGIN', '1')
    expect(confirmationTarget('recovery')).toBe('https://lekhan-staging-test.vercel.app/auth/confirm?flow=recovery')
    vi.stubEnv('VERCEL_URL', 'preview.vercel.app.example.test')
    expect(siteOrigin()).toBeNull()
    vi.stubEnv('VERCEL_URL', 'lekhan-staging-test.vercel.app')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(siteOrigin()).toBeNull()
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('LEKHAN_PUBLIC_URL', 'https://lekhan.example')
    expect(siteOrigin()).toBe('https://lekhan.example')
    vi.stubEnv('LEKHAN_PUBLIC_URL', 'invalid')
    expect(siteOrigin()).toBeNull()
  })

  it('trims email but does not change the entered password', () => {
    const data = new FormData()
    data.set('email', ' a@example.test ')
    data.set('password', 'exact password ')
    expect(readCredentials(data, 'login')).toEqual({ email: 'a@example.test', password: 'exact password ' })
    expect(readCredentials(data, 'reset')).toBeNull()
    data.set('confirmPassword', 'exact password ')
    expect(readCredentials(data, 'reset')).not.toBeNull()
  })

  it('only returns a local ownership transfer path for a valid token', () => {
    const token = 'a_'.repeat(21) + '-'
    expect(workspaceTransferPath(token)).toBe('/billing/transfer/' + token)
    expect(workspaceTransferPath(token + '/')).toBeNull()
    expect(workspaceTransferPath('//elsewhere.example')).toBeNull()
  })

  it('allows only safe billing next paths for post-auth checkout', () => {
    expect(billingNextPath('/billing')).toBe('/billing')
    expect(billingNextPath('/billing?tier=pro&cycle=annual&currency=inr')).toBe('/billing?tier=pro&cycle=annual&currency=inr')
    expect(billingNextPath('/billing?tier=team&seats=4')).toBe('/billing?tier=team&seats=4')
    expect(billingNextPath('//elsewhere.example')).toBeNull()
    expect(billingNextPath('/workspace')).toBeNull()
    expect(billingNextPath('/billing?tier=pro&url=https://evil.example')).toBeNull()
  })
})
