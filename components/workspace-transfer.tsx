'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
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
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TransferFailureCode | 'transferInviteFailed' | null>(null)

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (busy || typeof email !== 'string') return
    setError(null)
    setBusy(true)
    try {
      const result = await transferRequest({ action: 'invite', email })
      setUrl(result.url)
    } catch (failure) {
      setError(failure instanceof TransferFailure ? failure.code : 'transferInviteFailed')
    } finally {
      setBusy(false)
    }
  }

  return <section className="billing-transfer" aria-labelledby="billing-transfer">
    <h2 id="billing-transfer">{t('transferOwnership')}</h2>
    <p>{t('transferInviteIntro')}</p>
    <form className="account-form billing-transfer-form" onSubmit={invite}>
      <label>{t('recipientEmail')} <input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <button className="secondary-button" disabled={busy}>{busy ? t('creatingTransferLink') : t('createTransferLink')}</button>
    </form>
    {error && <p className="account-error" role="alert">{t(error)}</p>}
    {url && <>
      <p role="status">{t('transferLinkReady')}</p>
      <InviteLink key={url} path={url} origin={null} label={t('transferLink')} />
    </>}
  </section>
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

  return <>
    <p>{t('transferAcceptIntro')}</p>
    {error && <p className="account-error" role="alert">{t(error)}</p>}
    <button className="primary-button" type="button" disabled={busy} onClick={accept}>
      {busy ? t('confirmingTransfer') : t('acceptOwnership')}
    </button>
  </>
}
