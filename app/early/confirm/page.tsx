import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { confirmationToken } from '@/lib/waitlist/input'

export const metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function ConfirmEarlyAccess({ searchParams }: {
  searchParams: Promise<{ token?: string; result?: string }>
}) {
  const [query, t] = await Promise.all([searchParams, getTranslations('early-access')])
  const confirmed = query.result === 'confirmed'
  const token = typeof query.token === 'string' && confirmationToken.test(query.token) ? query.token : null
  return <main className="account-screen">
    <header className="account-header">
      <Link className="account-brand" href="/early"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
    </header>
    <section className="account-card" aria-labelledby="early-confirm-title">
      <h1 id="early-confirm-title">{t(confirmed ? 'confirmed' : 'confirmTitle')}</h1>
      {token && !confirmed ? <>
        <p>{t('confirmHint')}</p>
        <form className="account-form" method="post" action="/api/waitlist/confirm">
          <input type="hidden" name="token" value={token} />
          <button className="primary-button">{t('confirmButton')}</button>
        </form>
      </> : <>
        <p role="status">{t(confirmed ? 'confirmedHint' : query.result === 'unavailable' ? 'unavailable' : 'invalidConfirmation')}</p>
        <Link className="account-link" href="/early">{t('backEarly')}</Link>
      </>}
    </section>
  </main>
}
