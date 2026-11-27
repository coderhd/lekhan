import { getLocale, getTranslations } from 'next-intl/server'
import { desktopReturnLink } from '@/lib/auth/google-oauth'

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const destination = params.getAll('oauth').length === 1 && params.getAll('code').length <= 1
    ? desktopReturnLink(params.get('oauth'), params.get('code')) : null
  const [locale, t] = await Promise.all([getLocale(), getTranslations('auth')])
  const title = escapeHtml(t('googleDesktopTitle'))
  const message = escapeHtml(t(destination ? 'googleDesktopIntro' : 'googleDesktopInvalid'))
  return new Response(`<!doctype html>
<html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{margin:0;background:#f4f6ee;color:#14251b;font:16px/1.55 system-ui,sans-serif}
main{box-sizing:border-box;width:min(100% - 32px,420px);margin:12vh auto 24px;padding:28px;background:#fbfcf7;border:1px solid #d4dacd;border-radius:12px}
h1{margin:0;font:600 clamp(28px,6vw,38px)/1.15 Georgia,serif}
p{margin:16px 0}a{display:inline-block;padding:9px 15px;border-radius:8px;color:white;background:#274c36;text-decoration:none}
a:focus-visible{outline:2px solid #274c36;outline-offset:3px}
</style></head><body><main><h1>${title}</h1><p>${message}</p>${destination
    ? `<a href="${escapeHtml(destination)}" rel="noreferrer">${escapeHtml(t('googleDesktopOpen'))}</a>` : ''}</main></body></html>`,
  { headers, status: destination ? 200 : 400 })
}
