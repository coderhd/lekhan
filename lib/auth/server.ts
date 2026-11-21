import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { authConfig } from './config'

export async function createAuthClient() {
  const config = authConfig()
  if (!config) return null
  const store = await cookies()
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: cookies => {
        try {
          for (const { name, value, options } of cookies) store.set(name, value, options)
        } catch {
          // Server Components read auth cookies. The proxy writes refreshes.
        }
      },
    },
  })
}

export async function accountContext() {
  const client = await createAuthClient()
  if (!client) return null
  const { data, error } = await client.auth.getClaims()
  const subject = data?.claims.sub
  return !error && typeof subject === 'string' ? { client, subject } : null
}

export async function accountSubject() {
  return (await accountContext())?.subject ?? null
}
