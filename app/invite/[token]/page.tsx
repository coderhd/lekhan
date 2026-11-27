import NextLink from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { createServerAdmin } from '@/lib/auth/admin'
import { invitationPath } from '@/lib/auth/input'
import { accountContext } from '@/lib/auth/server'
import { inspectInvitation } from '@/lib/cloud/sharing'
import { respondToInvitation } from './actions'

export const metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function InvitationPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  if (!invitationPath(token)) notFound()
  const account = await accountContext()
  if (!account) redirect('/login?' + new URLSearchParams({ invite: token }))

  const admin = createServerAdmin()
  const invite = admin && await inspectInvitation(admin, token, account.subject).catch(() => null)
  const { result } = await searchParams
  if (invite?.status === 'accepted') redirect('/page/' + invite.page_id)
  if (invite?.status === 'declined') redirect('/cloud?view=invitations&notice=declined')

  const t = await getTranslations('cloud-workspace')
  return (
    <main className="account-screen">
      <header className="account-header">
        <NextLink className="account-brand" href="/cloud"><span className="brand-mark" aria-hidden="true">L</span> {t('title')}</NextLink>
      </header>
      <Card padding={6} className="account-card" aria-labelledby="invitation-heading">
        <VStack gap={3}>
          <Heading level={1} id="invitation-heading">{t('invitationTitle')}</Heading>
          {invite ? (
            <>
              <Text weight="semibold">{invite.title}</Text>
              <Text color="secondary">{invite.role === 'editor' ? t('invitedToEdit') : t('invitedToView')}</Text>
              {result && (
                <div role="alert">
                  <Banner
                    status="error"
                    collapsible={false}
                    title={result === 'limit'
                      ? t('recipientLimit')
                      : result === 'plan_changed' ? t('planChangedAccept')
                        : t('respondFailed')}
                  />
                </div>
              )}
              <form action={respondToInvitation.bind(null, token)}>
                <HStack gap={2} wrap="wrap" className="invitation-actions">
                  <Button type="submit" variant="primary" name="response" value="accepted" label={t('acceptInvitation')} />
                  <Button type="submit" variant="secondary" name="response" value="declined" label={t('decline')} />
                </HStack>
              </form>
            </>
          ) : (
            <>
              <Text color="secondary">{t('invalidRecipient')}</Text>
              <Link href={'/login?' + new URLSearchParams({ invite: token })}>{t('switchAccount')}</Link>
            </>
          )}
        </VStack>
      </Card>
    </main>
  )
}
