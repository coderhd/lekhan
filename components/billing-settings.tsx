'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check } from 'lucide-react'
import { useLocale } from '@/lib/i18n/client'
import { track } from '@/lib/analytics'
import { priceLabel, readOffer, unitAmount, type Currency, type Cycle, type PaidTier } from '@/lib/billing/catalog'
import type { readBillingSummary } from '@/lib/billing/workspace'
import RazorpayPlanChanges from './razorpay-plan-changes'

const tierNames = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team' }
const plans = [
  { tier: 'plus', features: ['Cloud sync', '90 days of version history'] },
  { tier: 'pro', features: ['Cloud sync', 'One year of version history'] },
  { tier: 'team', features: ['One year of version history', 'Collaborator seats with volume pricing'] },
] as const

const errors: Record<string, string> = {
  price_unavailable: 'Checkout is unavailable for this price. Try another currency or billing period.',
  offer_changed: 'Your workspace pricing changed. Refresh this page for the current price.',
  checkout_in_progress: 'There’s already a checkout for this workspace. Resume it or check the payment status here.',
  subscription_exists: 'This workspace already has a subscription. Open Manage payment to make changes.',
  invalid_offer: 'Choose a valid plan and number of seats.',
  billing_busy: 'Billing is being updated. Try again in a moment.',
  remove_scheduled_change: 'Cancel the scheduled plan change before canceling the subscription.',
}

const paymentMessages: Record<string, string> = {
  applied: 'Your payment is confirmed. Your workspace plan has been updated.',
  closed: 'The payment provider closed this checkout. You can start a new one.',
  recovered: 'Your checkout is ready to resume.',
  pending: 'The payment provider is still waiting for confirmation.',
  unlocated: 'The payment provider hasn’t confirmed this checkout. Contact support if you see a charge.',
}

export default function BillingSettings({ summary, defaultCurrency, available, returned, paused }: {
  summary: Awaited<ReturnType<typeof readBillingSummary>>
  defaultCurrency: Currency
  available: string[]
  returned: boolean
  paused: boolean
}) {
  const { pending, entitlement, canManage } = summary
  const locale = useLocale()
  const router = useRouter()
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [cycle, setCycle] = useState<Cycle>(pending?.cycle ?? 'monthly')
  const [seats, setSeats] = useState(String(pending?.tier === 'team' ? pending.seats : 2))
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showPlanChanges, setShowPlanChanges] = useState(false)
  const [failure, setFailure] = useState('')
  const [notice, setNotice] = useState('')
  const founding = entitlement?.isFounding === true
  const waiting = !!pending || (returned && entitlement?.status !== 'active')

  useEffect(() => {
    if (!waiting) return
    const interval = window.setInterval(() => router.refresh(), 3000)
    const stop = window.setTimeout(() => window.clearInterval(interval), 21_000)
    return () => { window.clearInterval(interval); window.clearTimeout(stop) }
  }, [waiting, router])

  async function act(action: 'checkout' | 'portal' | 'cancel' | 'check', tier?: PaidTier, usePending = false) {
    const selected = usePending && pending ? pending : { tier, cycle, currency, seats: Number(seats) }
    const offer = action === 'checkout' ? readOffer(selected) : null
    if (action === 'checkout' && !offer) {
      setFailure(errors.invalid_offer)
      return
    }
    if (busy) return
    setBusy(tier ?? action)
    setFailure('')
    setNotice('')
    if (offer && !usePending) track('upgrade_clicked', offer.tier, offer.cycle, offer.currency)
    try {
      const response = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...offer }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(errors[result.error] ?? 'Billing is temporarily unavailable. Try again in a moment.')
      if (result.url) {
        if (offer && !usePending) track('billing_checkout_started', offer.tier, offer.cycle, offer.currency)
        window.location.assign(result.url)
        return
      }
      if (action === 'cancel') {
        setConfirmCancel(false)
        setNotice('Cancellation scheduled for the end of the current billing period.')
      } else if (action === 'check') {
        setNotice(paymentMessages[result.result] ?? 'Check again in a moment if your plan hasn’t updated.')
      }
      router.refresh()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not open billing.')
    } finally {
      setBusy(null)
    }
  }

  const periodEnd = entitlement?.currentPeriodEnd
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(entitlement.currentPeriodEnd))
    : null
  return <>
    <section className="billing-current" aria-label="Current plan">
      <div>
        <p>Current plan</p>
        <h2>{tierNames[entitlement?.tier ?? 'free']}</h2>
      </div>
      <div>
        {entitlement?.cancelAtPeriodEnd ? <p>{periodEnd ? `Ends ${periodEnd}` : 'Ends at the close of this billing period'}</p>
          : periodEnd && entitlement?.status === 'active' ? <p>Renews {periodEnd}</p>
          : <p>{canManage ? 'Workspace subscription' : 'Unlimited pages in your local workspace'}</p>}
        {founding && <p>Founding pricing</p>}
      </div>
    </section>
    {entitlement?.status === 'past_due' && <p role="status" className="billing-notice">
      {entitlement.relayReadOnly ? 'Cloud editing is read-only until payment is resolved.' : 'A payment needs attention. Update your payment method to keep cloud editing active.'}
    </p>}
    {returned && <p role="status" className="billing-notice">{canManage && !pending ? 'Your subscription is ready.' : 'Waiting for payment confirmation. Your plan will update here.'}</p>}
    {paused && !canManage && <p className="billing-notice">Checkout was paused. You can pick up where you left off.</p>}
    {failure && <p className="account-error" role="alert">{failure}</p>}
    {notice && <p className="billing-notice" role="status">{notice}</p>}

    {canManage ? <div className="billing-actions">
      <button className="primary-button" disabled={!!busy} onClick={() => void act('portal')}>Manage payment <ArrowUpRight size={16} /></button>
      {summary.gateway === 'razorpay' && <button
        type="button" className="secondary-button" aria-expanded={showPlanChanges} disabled={!!busy}
        onClick={() => { setConfirmCancel(false); setShowPlanChanges(value => !value) }}
      >Change plan</button>}
      {!entitlement?.cancelAtPeriodEnd && <button className="secondary-button" disabled={!!busy} onClick={() => setConfirmCancel(value => !value)}>Cancel subscription</button>}
      {showPlanChanges && summary.gateway === 'razorpay' && <RazorpayPlanChanges />}
      {confirmCancel && <div className="billing-confirm">
        <p>{periodEnd ? `Your workspace keeps its plan through ${periodEnd}.` : 'Your workspace keeps its plan through the current billing period.'}</p>
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('cancel')}>Confirm cancellation</button>
        <button className="secondary-button" disabled={!!busy} onClick={() => setConfirmCancel(false)}>Keep subscription</button>
      </div>}
    </div> : <>
      {pending && <div className="billing-actions">
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('checkout', pending.tier, true)}>
          Resume {tierNames[pending.tier]} checkout <ArrowUpRight size={15} />
        </button>
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('check')}>
          {busy === 'check' ? 'Checking payment…' : 'Check payment status'}
        </button>
      </div>}
      <div className="billing-controls">
        <label>Currency <select value={currency} onChange={event => setCurrency(event.target.value === 'INR' ? 'INR' : 'USD')}>
          <option value="USD">USD · US dollars</option>
          <option value="INR">INR · Indian rupees</option>
        </select></label>
        <label>Billing period <select value={cycle} onChange={event => setCycle(event.target.value === 'annual' ? 'annual' : 'monthly')}>
          <option value="monthly">Monthly</option><option value="annual">Annual</option>
        </select></label>
      </div>
      <div className="billing-plans" aria-label="Paid plans">
        {plans.map(({ tier, features }) => {
          const teamInr = tier === 'team' && currency === 'INR'
          const offer = readOffer({ tier, cycle, currency, seats: Number(seats) })
          const amount = offer && unitAmount(offer, founding) * offer.seats
          const enabled = available.includes(`${currency}:${tier}:${cycle}`)
          return <section className="billing-plan" key={tier} aria-labelledby={`plan-${tier}`}>
            <h2 id={`plan-${tier}`}>{tierNames[tier]}</h2>
            <div className="billing-price">
              <strong>{amount ? priceLabel(amount, currency, locale) : teamInr ? 'USD only' : '—'}</strong>
              {amount && <span> / {cycle === 'annual' ? 'year' : 'month'}</span>}
            </div>
            {tier === 'team' && !teamInr && <label className="billing-seats">Seats
              <input type="number" min={2} step={1} value={seats} onChange={event => setSeats(event.target.value)} />
              {offer && <span>{priceLabel(unitAmount(offer, founding), currency, locale)} per seat</span>}
            </label>}
            <ul>{features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" /> {feature}</li>)}</ul>
            {teamInr ? <button className="secondary-button" onClick={() => setCurrency('USD')}>See Team in USD</button>
              : <button className="primary-button" disabled={!enabled || !offer || !!busy} onClick={() => void act('checkout', tier)}>
                {busy === tier ? 'Opening checkout…' : enabled ? `Choose ${tierNames[tier]}` : 'Checkout unavailable'} <ArrowUpRight size={15} />
              </button>}
          </section>
        })}
      </div>
    </>}
  </>
}
