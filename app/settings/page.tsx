import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import BillingPanel from '@/components/settings/billing-panel'
import WebSettings from '@/components/settings/web-settings'
import { authConfig } from '@/lib/auth/config'
import { accountContext } from '@/lib/auth/server'

export async function generateMetadata() {
  const t = await getTranslations('settings')
  return { title: t('title') + ' · Lekhan' }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; checkout?: string; transfer?: string }> }) {
  const [account, query, t] = await Promise.all([accountContext(), searchParams, getTranslations('settings')])
  const user = account ? (await account.client.auth.getUser()).data.user : null
  const savedName = user?.user_metadata.full_name
  return <main className="settings-page">
    <header className="account-header">
      <Link className="account-brand" href="/"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</Link>
      <Link className="account-link" href="/workspace"><ArrowLeft aria-hidden="true" size={16} /> {t('backToWorkspace')}</Link>
    </header>
    <WebSettings scope={account ? 'account:' + account.subject : 'personal'} available={!!authConfig()} openTab={query.tab}
      profile={account ? { subject: account.subject, email: account.email,
        displayName: typeof savedName === 'string' ? savedName.slice(0, 100) : account.displayName } : undefined}
      plan={account && <BillingPanel account={account} query={query} />} />
  </main>
}
