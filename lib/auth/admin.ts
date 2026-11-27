import { createClient } from '@supabase/supabase-js'
import { authConfig } from './config.ts'

export function createServerAdmin() {
  const config = authConfig()
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
  if (!config || !key) return null
  return createClient(config.url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
