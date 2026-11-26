'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check } from 'lucide-react'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { billingMeasurement, track } from '@/lib/analytics'
import { priceLabel, readOffer, unitAmount, type Currency, type Cycle, type PaidTier } from '@/lib/billing/catalog'
import type { readBillingSummary } from '@/lib/billing/workspace'
import RazorpayPlanChanges from './razorpay-plan-changes'

const tierNames = { plus: 'Plus', pro: 'Pro', team: 'Team' }
const plans = [
  { tier: 'plus', features: ['cloudSync', 'plusHistory'] },
  { tier: 'pro', features: ['cloudSync', 'yearHistory'] },
  { tier: 'team', features: ['yearHistory', 'teamSeats'] },
] as const

const errors = {
  price_unavailable: 'priceUnavailable', offer_changed: 'offerChanged', checkout_in_progress: 'checkoutInProgress',
  subscription_exists: 'subscriptionExists', workspace_changed: 'workspaceChanged', invalid_offer: 'invalidOffer',
  billing_busy: 'billingBusy', remove_scheduled_change: 'removeBeforeCancellation',
} as const

const paymentMessages = {
  applied: 'paymentApplied', closed: 'paymentClosed', recovered: 'paymentRecovered',
  pending: 'paymentPending', unlocated: 'paymentUnlocated',
} as const

type BillingFailure = (typeof errors)[keyof typeof errors] | 'actionUnavailable' | 'openFailed'
type BillingNotice = (typeof paymentMessages)[keyof typeof paymentMessages] | 'checkAgain' | 'cancellationScheduled'

export default function BillingSettings({ summary, defaultCurrency, available, returned, paused }: {
  summary: Awaited<ReturnType<typeof readBillingSummary>>
  defaultCurrency: Currency
  available: string[]
  returned: boolean
  paused: boolean
}) {
  const { pending, entitlement, canManage } = summary
  const locale = useLocale()
  const t = useTranslations('billing')
  const router = useRouter()
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [cycle, setCycle] = useState<Cycle>(pending?.cycle ?? 'monthly')
  const [seats, setSeats] = useState(String(pending?.tier === 'team' ? pending.seats : 2))
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showPlanChanges, setShowPlanChanges] = useState(false)
  const [failure, setFailure] = useState<BillingFailure | null>(null)
  const [notice, setNotice] = useState<BillingNotice | null>(null)
  const founding = summary.checkoutFounding
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
      setFailure('invalidOffer')
      return
    }
    if (busy) return
    setBusy(tier ?? action)
    setFailure(null)
    setNotice(null)
    if (offer && !usePending) track('upgrade_clicked', offer.tier, offer.cycle, offer.currency)
    try {
      const measurement = offer && !usePending ? await billingMeasurement() : undefined
      const response = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...offer, measurement }),
      })
      const result = await response.json()
      if (!response.ok) {
        const key = Object.hasOwn(errors, result.error) ? errors[result.error as keyof typeof errors] : 'actionUnavailable'
        setFailure(key)
        return
      }
      if (result.url) {
        if (offer && !usePending) track('checkout_started', offer.tier, offer.cycle, offer.currency)
        window.location.assign(result.url)
        return
      }
      if (action === 'cancel') {
        setConfirmCancel(false)
        setNotice('cancellationScheduled')
      } else if (action === 'check') {
        setNotice(Object.hasOwn(paymentMessages, result.result) ? paymentMessages[result.result as keyof typeof paymentMessages] : 'checkAgain')
      }
      router.refresh()
    } catch {
      setFailure('openFailed')
    } finally {
      setBusy(null)
    }
  }

  const periodEnd = entitlement?.currentPeriodEnd
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(entitlement.currentPeriodEnd))
    : null
  return <>
    <section className="billing-current" aria-label={t('currentPlan')}>
      <div>
        <p>{t('currentPlan')}</p>
        <h2>{!entitlement || entitlement.tier === 'free' ? t('free') : tierNames[entitlement.tier]}</h2>
      </div>
      <div>
        {entitlement?.cancelAtPeriodEnd ? <p>{periodEnd ? t('endsOn', { date: periodEnd }) : t('endsAtPeriod')}</p>
          : periodEnd && entitlement?.status === 'active' ? <p>{t('renewsOn', { date: periodEnd })}</p>
          : <p>{canManage ? t('workspaceSubscription') : t('localUnlimited')}</p>}
        {entitlement?.isFounding && <p>{t('foundingPricing')}</p>}
      </div>
    </section>
    {entitlement?.status === 'past_due' && <p role="status" className="billing-notice">
      {entitlement.relayReadOnly ? t('paymentReadOnly') : t('paymentAttention')}
    </p>}
    {returned && <p role="status" className="billing-notice">{canManage && !pending ? t('subscriptionReady') : t('awaitingPayment')}</p>}
    {summary.canReattach && <p className="billing-notice">
      {t('reattach')}
    </p>}
    {paused && !canManage && <p className="billing-notice">{t('pausedCheckout')}</p>}
    {failure && <p className="account-error" role="alert">{t(failure)}</p>}
    {notice && <p className="billing-notice" role="status">{t(notice)}</p>}

    {canManage ? <div className="billing-actions">
      <button className="primary-button" disabled={!!busy} onClick={() => void act('portal')}>{t('managePayment')} <ArrowUpRight size={16} /></button>
      {summary.gateway === 'razorpay' && <button
        type="button" className="secondary-button" aria-expanded={showPlanChanges} disabled={!!busy}
        onClick={() => { setConfirmCancel(false); setShowPlanChanges(value => !value) }}
      >{t('changePlan')}</button>}
      {!entitlement?.cancelAtPeriodEnd && <button className="secondary-button" disabled={!!busy} onClick={() => setConfirmCancel(value => !value)}>{t('cancelSubscription')}</button>}
      {showPlanChanges && summary.gateway === 'razorpay' && <RazorpayPlanChanges />}
      {confirmCancel && <div className="billing-confirm">
        <p>{periodEnd ? t('keepsThroughDate', { date: periodEnd }) : t('keepsThroughPeriod')}</p>
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('cancel')}>{t('confirmCancellation')}</button>
        <button className="secondary-button" disabled={!!busy} onClick={() => setConfirmCancel(false)}>{t('keepSubscription')}</button>
      </div>}
    </div> : <>
      {pending && <div className="billing-actions">
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('checkout', pending.tier, true)}>
          {t('resumeCheckout', { plan: tierNames[pending.tier] })} <ArrowUpRight size={15} />
        </button>
        <button className="secondary-button" disabled={!!busy} onClick={() => void act('check')}>
          {busy === 'check' ? t('checkingPayment') : t('checkPayment')}
        </button>
      </div>}
      <div className="billing-controls">
        <label>{t('currency')}<select value={currency} onChange={event => setCurrency(event.target.value === 'INR' ? 'INR' : 'USD')}>
          <option value="USD">{t('usd')}</option>
          <option value="INR">{t('inr')}</option>
        </select></label>
        <label>{t('period')}<select value={cycle} onChange={event => setCycle(event.target.value === 'annual' ? 'annual' : 'monthly')}>
          <option value="monthly">{t('monthly')}</option><option value="annual">{t('annual')}</option>
        </select></label>
      </div>
      <div className="billing-plans" aria-label={t('paidPlans')}>
        {plans.map(({ tier, features }) => {
          const teamInr = tier === 'team' && currency === 'INR'
          const offer = readOffer({ tier, cycle, currency, seats: Number(seats) })
          const amount = offer && unitAmount(offer, founding) * offer.seats
          const enabled = available.includes(`${currency}:${tier}:${cycle}`)
          return <section className="billing-plan" key={tier} aria-labelledby={`plan-${tier}`}>
            <h2 id={`plan-${tier}`}>{tierNames[tier]}</h2>
            <div className="billing-price">
              <strong>{amount ? priceLabel(amount, currency, locale) : teamInr ? t('usdOnly') : '—'}</strong>
              {amount && <span>{t(cycle === 'annual' ? 'perYear' : 'perMonth')}</span>}
            </div>
            {tier === 'team' && !teamInr && <label className="billing-seats">{t('seats')}
              <input type="number" min={2} step={1} value={seats} onChange={event => setSeats(event.target.value)} />
              {offer && <span>{t('pricePerSeat', { price: priceLabel(unitAmount(offer, founding), currency, locale) })}</span>}
            </label>}
            <ul>{features.map(feature => <li key={feature}><Check size={15} aria-hidden="true" /> {t(feature)}</li>)}</ul>
            {teamInr ? <button className="secondary-button" onClick={() => setCurrency('USD')}>{t('teamUsd')}</button>
              : <button className="primary-button" disabled={!enabled || !offer || !!busy} onClick={() => void act('checkout', tier)}>
                {busy === tier ? t('openingCheckout') : enabled ? t('chooseTier', { plan: tierNames[tier] }) : t('checkoutUnavailable')} <ArrowUpRight size={15} />
              </button>}
          </section>
        })}
      </div>
    </>}
  </>
}
