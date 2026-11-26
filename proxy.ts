import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { authConfig } from './lib/auth/config'
import { authSessionCookie, offlineAccountCookie } from './lib/cloud/offline-account'
import { localeCookie } from './lib/i18n/locales'
import { localizedMarketingRoute } from './lib/marketing/routes'

export async function proxy(request: NextRequest) {
  const localized = localizedMarketingRoute(request.nextUrl.pathname)
  if (localized) {
    const url = request.nextUrl.clone()
    url.pathname = localized.path
    const changed = request.cookies.get(localeCookie)?.value !== localized.locale
    request.cookies.set(localeCookie, localized.locale)
    const response = NextResponse.rewrite(url, { request: { headers: new Headers(request.headers) } })
    if (changed && request.method === 'GET') {
      response.cookies.set(localeCookie, localized.locale, {
        path: '/', sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 365 * 24 * 60 * 60,
      })
    }
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
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

  const { data, error } = await client.auth.getClaims()
  const name = authSessionCookie(settings.url)
  const existing = request.cookies.get(offlineAccountCookie)?.value
  const options = { path: '/', sameSite: 'lax' as const, secure: request.nextUrl.protocol === 'https:' }
  if (!error && typeof data?.claims.sub === 'string') {
    const marker = data.claims.sub + ':' + name
    const pathname = request.nextUrl.pathname
    if (existing !== marker || pathname === '/workspace' || pathname === '/cloud' || pathname.startsWith('/page/')) response.cookies.set(offlineAccountCookie, marker, { ...options, maxAge: 30 * 24 * 60 * 60 })
  } else if (existing && (!request.cookies.has(name) && !request.cookies.has(name + '.0') || error?.status === 401 || error?.status === 403)) {
    response.cookies.set(offlineAccountCookie, '', { ...options, maxAge: 0 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = { matcher: ['/:locale(en|hi|zh|es|de)', '/:locale(en|hi|zh|es|de)/:section(about|faq|contact)', '/workspace', '/login', '/signup', '/forgot-password', '/reset-password', '/cloud/:path*', '/billing', '/page/:path*', '/invite/:path*', '/api/billing', '/api/billing/plan-change', '/api/sync/:path*', '/api/search', '/api/checkpoints', '/api/import', '/api/page-link'] }
