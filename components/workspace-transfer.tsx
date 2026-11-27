'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useTranslations } from '@/lib/i18n/client'
import InviteLink from './invite-link'

const messages = {
  transfer_invalid_recipient: 'transferInvalidRecipient', transfer_recipient_has_workspace: 'recipientHasWorkspace',
  transfer_invalid_link: 'transferInvalidLink', transfer_plan_changed: 'transferPlanChanged',
  transfer_checkout_pending: 'transferCheckoutPending', transfer_payment_pending: 'transferPaymentPending',
  transfer_referral_pending: 'transferReferralPending', transfer_renewal_unverified: 'transferRenewalUnverified',
  remove_scheduled_change: 'removeBeforeTransfer', transfer_in_progress: 'transferInProgress', billing_busy: 'transferInProgress',
} as const

type TransferFailureCode = (typeof messages)[keyof typeof messages] | 'transferUpdateFailed'

class TransferFailure extends Error {
  constructor(readonly code: TransferFailureCode) { super(code) }
}

async function transferRequest(input: { action: 'invite'; email: string } | { action: 'accept'; token: string }) {
  const response = await fetch('/api/billing/transfer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  const result = await response.json()
  if (!response.ok) throw new TransferFailure(Object.hasOwn(messages, result.error) ? messages[result.error as keyof typeof messages] : 'transferUpdateFailed')
  return result
}

export function WorkspaceTransferInvite() {
  const t = useTranslations('billing')
  const [email, setEmail] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TransferFailureCode | 'transferInviteFailed' | null>(null)

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !email.trim()) return
    setError(null)
    setBusy(true)
    try {
      const result = await transferRequest({ action: 'invite', email: email.trim() })
      setUrl(result.url)
    } catch (failure) {
      setError(failure instanceof TransferFailure ? failure.code : 'transferInviteFailed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="billing-transfer" aria-labelledby="billing-transfer">
      <VStack gap={3}>
        <Heading level={2} id="billing-transfer">{t('transferOwnership')}</Heading>
        <Text color="secondary">{t('transferInviteIntro')}</Text>
        <form onSubmit={invite}>
          <VStack gap={3} align="start" className="billing-transfer-form">
            <TextInput
              type="email"
              label={t('recipientEmail')}
              htmlName="email"
              autoComplete="off"
              isRequired
              width="100%"
              value={email}
              onChange={value => setEmail(value.slice(0, 254))}
            />
            <Button
              type="submit"
              variant="secondary"
              isLoading={busy}
              label={busy ? t('creatingTransferLink') : t('createTransferLink')}
            />
          </VStack>
        </form>
        {error && <div role="alert"><Banner status="error" collapsible={false} title={t(error)} /></div>}
        {url && (
          <VStack gap={2}>
            <Text type="supporting" role="status">{t('transferLinkReady')}</Text>
            <InviteLink key={url} path={url} origin={null} label={t('transferLink')} />
          </VStack>
        )}
      </VStack>
    </section>
  )
}

export function WorkspaceTransferAccept({ token }: { token: string }) {
  const router = useRouter()
  const t = useTranslations('billing')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TransferFailureCode | 'transferAcceptFailed' | null>(null)

  async function accept() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await transferRequest({ action: 'accept', token })
      router.replace('/billing?transfer=accepted')
    } catch (failure) {
      setError(failure instanceof TransferFailure ? failure.code : 'transferAcceptFailed')
      setBusy(false)
    }
  }

  return (
    <VStack gap={3} align="start">
      <Text color="secondary">{t('transferAcceptIntro')}</Text>
      {error && <div role="alert" style={{ width: '100%' }}><Banner status="error" collapsible={false} title={t(error)} /></div>}
      <Button
        type="button"
        variant="primary"
        isLoading={busy}
        label={busy ? t('confirmingTransfer') : t('acceptOwnership')}
        onClick={accept}
      />
    </VStack>
  )
}
