import Link from 'next/link'
import { ArrowUpRight, Eye, LockKeyhole } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { readPublicContent } from '@/lib/cloud/public-page'
import PublicPageBody from './public-page-body'
import PublicReadingLayout from './public-reading-layout'

export async function PublicPage({ title, content }: {
  title: string
  content: Awaited<ReturnType<typeof readPublicContent>> | null
}) {
  const t = await getTranslations('public-page')
  return <PublicReadingLayout>
    <header className="public-reader-header">
      <Link href="/" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <span className="public-reader-badge"><Eye size={15} aria-hidden="true" />{t('viewOnly')}</span>
    </header>
    <article className="public-reader-article">
      <h1>{title}</h1>
      <p className="public-reader-notice">{t('linkNotice')}</p>
      {content ? <>
        <PublicPageBody source={content.source} targets={content.targets} taskStatus={t('taskStatus')} />
        {content.children.length > 0 && <nav aria-label={t('subpages')} className="public-reader-children">
          <h2>{t('subpages')}</h2>
          <ul>{content.children.map(child => <li key={child.id}><Link href={'/page/' + child.id}>{child.title}</Link></li>)}</ul>
        </nav>}
      </> : <p role="status">{t('temporarilyUnavailable')}</p>}
    </article>
    <footer className="public-reader-footer">
      <span>{t('poweredBy')}</span>
      <Link href="/signup">{t('createWorkspace')} <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </footer>
  </PublicReadingLayout>
}

export async function PageUnavailable({ signedIn }: { signedIn: boolean }) {
  const t = await getTranslations('public-page')
  return <main className="account-screen">
    <header className="account-header">
      <Link href="/" className="account-brand"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
    </header>
    <section className="account-card public-unavailable" aria-labelledby="unavailable-title">
      <span className="page-emblem" aria-hidden="true"><LockKeyhole size={21} /></span>
      <h1 id="unavailable-title">{t('unavailable')}</h1>
      <p>{t(signedIn ? 'memberHint' : 'visitorHint')}</p>
      <div className="account-links">
        <Link className="primary-button" href={signedIn ? '/workspace' : '/login'}>{t(signedIn ? 'backHome' : 'login')}</Link>
        {!signedIn && <Link href="/signup">{t('createWorkspace')}</Link>}
      </div>
    </section>
  </main>
}
