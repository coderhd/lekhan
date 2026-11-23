'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/lib/i18n/client'
import { priceLabel } from '@/lib/billing/catalog'
import type { readPlanChanges } from '@/lib/billing/plan-changes'

type Changes = Awaited<ReturnType<typeof readPlanChanges>>

const messages: Record<string, string> = {
  billing_busy: 'Billing is being updated. Try again in a moment.',
  remove_scheduled_change: 'Cancel the existing scheduled change before choosing a different plan.',
  scheduled_change_updated: 'The scheduled change has already changed. Reopen this panel for the current status.',
  payment_method_cannot_change_plan: 'Razorpay can’t change a subscription paid by UPI or e-mandate. You can cancel at renewal and then choose your new plan.',
  subscription_not_changeable: 'This subscription is unavailable for a scheduled plan change.',
}

function planLabel(offer: { tier: string; cycle: string }) {
  return `${offer.tier === 'plus' ? 'Plus' : 'Pro'} · ${offer.cycle === 'annual' ? 'Annual' : 'Monthly'}`
}

export default function RazorpayPlanChanges() {
  const locale = useLocale()
  const [changes, setChanges] = useState<Changes | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/billing/plan-change', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Plan changes are temporarily unavailable.')
        const result = await response.json() as Changes
        if (!controller.signal.aborted) setChanges(result)
      }).catch(() => {
        if (!controller.signal.aborted) setError('Plan changes are temporarily unavailable.')
      })
    return () => controller.abort()
  }, [])

  const choice = changes?.options.find(({ offer }) => offer.tier + ':' + offer.cycle === selected)
  const scheduled = changes?.scheduled

  async function update(action: 'schedule' | 'remove') {
    if (busy) return
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const payload = action === 'schedule' ? { action, ...choice?.offer } : { action, key: scheduled?.key }
      const response = await fetch('/api/billing/plan-change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(messages[result.error] ?? 'Razorpay hasn’t confirmed the update. Reopen this panel to check its status.')
      setChanges(result)
      setSelected('')
      setNotice(action === 'remove' ? 'Scheduled plan change canceled.' : 'Plan change scheduled.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not update the subscription.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="billing-confirm billing-plan-changes" aria-label="Plan changes">
    {error && <p className="account-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!changes && !error && <p role="status">Checking the subscription…</p>}
    {scheduled && <>
      <p>
        <strong>{scheduled.offer ? planLabel(scheduled.offer) : 'Scheduled plan change'}</strong>
        {' · '}{scheduled.effectiveAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(scheduled.effectiveAt)) : 'At renewal'}
      </p>
      <button className="secondary-button" disabled={busy} type="button" onClick={() => void update('remove')}>Cancel plan change</button>
    </>}
    {!scheduled && changes && (changes.options.length ? <>
      <p>The new plan starts at the end of the current billing cycle.</p>
      <label className="billing-change-select">New plan
        <select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
          <option value="">Choose a plan</option>
          {changes.options.map(({ offer, amount }) => <option key={offer.tier + ':' + offer.cycle} value={offer.tier + ':' + offer.cycle}>
            {planLabel(offer)} · {priceLabel(amount, 'INR', locale)}
          </option>)}
        </select>
      </label>
      <button className="primary-button" disabled={!choice || busy} type="button" onClick={() => void update('schedule')}>Schedule plan change</button>
    </> : <p>No plan changes are available for this subscription.</p>)}
  </section>
}
