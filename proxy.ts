import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { authConfig } from './lib/auth/config'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const settings = authConfig()
  if (!settings) return response

  const client = createServerClient(settings.url, settings.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value } of cookies) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options)
        if (headers) for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
      },
    },
  })

  await client.auth.getClaims()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = { matcher: ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/cloud/:path*', '/page/:path*', '/invite/:path*', '/api/sync/:path*', '/api/search', '/api/checkpoints', '/api/import', '/api/page-link'] }
