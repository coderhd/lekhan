import NextLink from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { confirmationToken } from '@/lib/waitlist/input'

export const metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function ConfirmEarlyAccess({ searchParams }: {
  searchParams: Promise<{ token?: string; result?: string }>
}) {
  const [query, t] = await Promise.all([searchParams, getTranslations('early-access')])
  const confirmed = query.result === 'confirmed'
  const token = typeof query.token === 'string' && confirmationToken.test(query.token) ? query.token : null
  return (
    <main className="account-screen">
      <header className="account-header">
        <NextLink className="account-brand" href="/early"><span className="brand-mark" aria-hidden="true">L</span> Lekhan</NextLink>
      </header>
      <Card padding={6} className="account-card" aria-labelledby="early-confirm-title">
        <VStack gap={3}>
          <Heading level={1} id="early-confirm-title">{t(confirmed ? 'confirmed' : 'confirmTitle')}</Heading>
          {token && !confirmed ? (
            <>
              <Text color="secondary">{t('confirmHint')}</Text>
              <form className="account-form" method="post" action="/api/waitlist/confirm">
                <input type="hidden" name="token" value={token} />
                <Button type="submit" variant="primary" width="100%" label={t('confirmButton')} />
              </form>
            </>
          ) : (
            <>
              <div role="status">
                <Banner
                  status={confirmed ? 'success' : 'info'}
                  collapsible={false}
                  title={t(confirmed ? 'confirmedHint' : query.result === 'unavailable' ? 'unavailable' : 'invalidConfirmation')}
                />
              </div>
              <Link href="/early">{t('backEarly')}</Link>
            </>
          )}
        </VStack>
      </Card>
    </main>
  )
}
