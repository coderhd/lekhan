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

export async function accountSubject() {
  const client = await createAuthClient()
  if (!client) return null
  const { data, error } = await client.auth.getClaims()
  return !error && typeof data?.claims.sub === 'string' ? data.claims.sub : null
}
