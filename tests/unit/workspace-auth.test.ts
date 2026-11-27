import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authConfig: null as { url: string; publishableKey: string } | null,
  account: null as { client: { auth: { getUser: ReturnType<typeof vi.fn> } }; subject: string; email: string; displayName: string } | null,
  cookiesHeader: '',
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ toString: () => state.cookiesHeader })),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error('NEXT_REDIRECT:' + path)
  }),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/auth/config', () => ({
  authConfig: () => state.authConfig,
}))
vi.mock('@/lib/auth/server', () => ({
  accountContext: async () => state.account,
}))
vi.mock('@/lib/sync/config', () => ({
  syncUrl: () => null,
}))
vi.mock('@/lib/sync/ticket', () => ({
  getTicketSecret: () => null,
}))
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOwnerWorkspaceEntitlement: vi.fn(async () => null),
}))
vi.mock('@/components/prepare-offline-workspace', () => ({
  PrepareOfflineWorkspace: () => null,
}))
vi.mock('@/components/web-workspace', () => ({
  default: (props: Record<string, unknown>) => props,
}))
vi.mock('@/components/settings/billing-panel', () => ({
  default: () => null,
}))
vi.mock('@/components/settings/web-settings', () => ({
  default: (props: Record<string, unknown>) => props,
}))

import WorkspacePage from '../../app/workspace/page'
import SettingsPage from '../../app/settings/page'

const subject = '4dbc5892-753d-4be6-9d78-faaeb9bbd2d7'
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const sessionValue = encodeURIComponent('base64-' + encode({ access_token: 'test.' + encode({ sub: subject, exp: 1 }) + '.sig' }))
const offlineMarker = encodeURIComponent(subject + ':sb-project-auth-token')

describe('workspace route authentication', () => {
  beforeEach(() => {
    state.authConfig = null
    state.account = null
    state.cookiesHeader = ''
  })

  it('redirects /workspace to /login when auth is unconfigured', async () => {
    await expect(WorkspacePage()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('redirects /workspace to /login when unauthenticated without an offline continuity cookie', async () => {
    state.authConfig = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_fixture' }
    await expect(WorkspacePage()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('redirects /workspace to /workspace-offline only for a verified offline continuity cookie', async () => {
    state.authConfig = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_fixture' }
    state.cookiesHeader = `lekhan-offline-account=${offlineMarker}; sb-project-auth-token=${sessionValue}`
    await expect(WorkspacePage()).rejects.toThrow('NEXT_REDIRECT:/workspace-offline')
  })

  it('opens the account-scoped workspace when authenticated', async () => {
    state.authConfig = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_fixture' }
    state.account = {
      client: { auth: { getUser: vi.fn() } },
      subject,
      email: 'writer@lekhan.test',
      displayName: 'Lekhan Writer',
    }
    const rendered = await WorkspacePage()
    expect(JSON.stringify(rendered)).toContain(`"storageScope":"account:${subject}"`)
    expect(JSON.stringify(rendered)).toContain('"signedIn":true')
  })

  it('redirects /settings to /login when unauthenticated', async () => {
    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login')
  })
})
