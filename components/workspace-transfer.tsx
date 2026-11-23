'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import InviteLink from './invite-link'

const messages: Record<string, string> = {
  transfer_invalid_recipient: 'Enter the verified email of another Lekhan account.',
  transfer_recipient_has_workspace: 'The recipient already owns a cloud workspace. Each account can own one workspace.',
  transfer_invalid_link: 'This transfer link is unavailable.',
  transfer_plan_changed: 'The workspace plan changed. Try accepting again.',
  transfer_checkout_pending: 'A checkout is still open. Ask the owner to resolve it before you accept.',
  transfer_payment_pending: 'The subscription has a payment issue. Ask the current owner to resolve it first.',
  transfer_referral_pending: 'A referral credit is still processing. Try again once it settles.',
  transfer_renewal_unverified: 'The provider hasn’t confirmed cancellation. Try again before completing the transfer.',
  remove_scheduled_change: 'Ask the current owner to remove the scheduled plan change before accepting.',
  transfer_in_progress: 'Another billing change is in progress. Try again in a moment.',
  billing_busy: 'Another billing change is in progress. Try again in a moment.',
}

async function transferRequest(input: { action: 'invite'; email: string } | { action: 'accept'; token: string }) {
  const response = await fetch('/api/billing/transfer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(messages[result.error] ?? 'Could not update workspace ownership. Try again in a moment.')
  return result
}

export function WorkspaceTransferInvite() {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get('email')
    if (busy || typeof email !== 'string') return
    setError('')
    setBusy(true)
    try {
      const result = await transferRequest({ action: 'invite', email })
      setUrl(result.url)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the transfer link.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="billing-transfer" aria-labelledby="billing-transfer">
    <h2 id="billing-transfer">Transfer workspace ownership</h2>
    <p>The new owner takes responsibility for billing once they accept. Your subscription stops renewing and the workspace keeps its current paid period. Individual page permissions stay in place.</p>
    <form className="account-form billing-transfer-form" onSubmit={invite}>
      <label>Recipient’s account email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
      <button className="secondary-button" disabled={busy}>{busy ? 'Creating link…' : 'Create transfer link'}</button>
    </form>
    {error && <p className="account-error" role="alert">{error}</p>}
    {url && <>
      <p role="status">Send this link to the recipient. It expires in seven days and replaces any earlier transfer link.</p>
      <InviteLink key={url} path={url} origin={null} label="Workspace transfer link" />
    </>}
  </section>
}

export function WorkspaceTransferAccept({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function accept() {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await transferRequest({ action: 'accept', token })
      router.replace('/billing?transfer=accepted')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not accept the transfer.')
      setBusy(false)
    }
  }

  return <>
    <p>Accepting gives you control of workspace billing. The current paid period carries over. You can set up your own subscription after accepting.</p>
    {error && <p className="account-error" role="alert">{error}</p>}
    <button className="primary-button" type="button" disabled={busy} onClick={accept}>
      {busy ? 'Confirming transfer…' : 'Accept ownership'}
    </button>
  </>
}
