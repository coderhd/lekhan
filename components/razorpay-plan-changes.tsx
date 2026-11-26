'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { priceLabel } from '@/lib/billing/catalog'
import type { readPlanChanges } from '@/lib/billing/plan-changes'

type Changes = Awaited<ReturnType<typeof readPlanChanges>>

const messages = {
  billing_busy: 'billingBusy', remove_scheduled_change: 'removeExistingChange',
  scheduled_change_updated: 'scheduledChangeUpdated', payment_method_cannot_change_plan: 'methodCannotChangePlan',
  subscription_not_changeable: 'subscriptionNotChangeable',
} as const

export default function RazorpayPlanChanges() {
  const locale = useLocale()
  const t = useTranslations('billing')
  const planLabel = (offer: { tier: string; cycle: string }) =>
    `${offer.tier === 'plus' ? 'Plus' : 'Pro'} · ${t(offer.cycle === 'annual' ? 'annual' : 'monthly')}`
  const [changes, setChanges] = useState<Changes | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'scheduledChangeCancelled' | 'planChangeScheduled' | null>(null)
  const [error, setError] = useState<(typeof messages)[keyof typeof messages] | 'planChangesUnavailable' | 'providerUpdateUnconfirmed' | 'subscriptionUpdateFailed' | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/billing/plan-change', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Plan changes unavailable')
        const result = await response.json() as Changes
        if (!controller.signal.aborted) setChanges(result)
      }).catch(() => {
        if (!controller.signal.aborted) setError('planChangesUnavailable')
      })
    return () => controller.abort()
  }, [])

  const choice = changes?.options.find(({ offer }) => offer.tier + ':' + offer.cycle === selected)
  const scheduled = changes?.scheduled

  async function update(action: 'schedule' | 'remove') {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const payload = action === 'schedule' ? { action, ...choice?.offer } : { action, key: scheduled?.key }
      const response = await fetch('/api/billing/plan-change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(Object.hasOwn(messages, result.error) ? messages[result.error as keyof typeof messages] : 'providerUpdateUnconfirmed')
        return
      }
      setChanges(result)
      setSelected('')
      setNotice(action === 'remove' ? 'scheduledChangeCancelled' : 'planChangeScheduled')
    } catch {
      setError('subscriptionUpdateFailed')
    } finally {
      setBusy(false)
    }
  }

  return <section className="billing-confirm billing-plan-changes" aria-label={t('planChanges')}>
    {error && <p className="account-error" role="alert">{t(error)}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {!changes && !error && <p role="status">{t('checkingSubscription')}</p>}
    {scheduled && <>
      <p>
        <strong>{scheduled.offer ? planLabel(scheduled.offer) : t('scheduledChange')}</strong>
        {' · '}{scheduled.effectiveAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(scheduled.effectiveAt)) : t('atRenewal')}
      </p>
      <button className="secondary-button" disabled={busy} type="button" onClick={() => void update('remove')}>{t('cancelPlanChange')}</button>
    </>}
    {!scheduled && changes && (changes.options.length ? <>
      <p>{t('newPlanStarts')}</p>
      <label className="billing-change-select">{t('newPlan')}
        <select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy}>
          <option value="">{t('choosePlan')}</option>
          {changes.options.map(({ offer, amount }) => <option key={offer.tier + ':' + offer.cycle} value={offer.tier + ':' + offer.cycle}>
            {planLabel(offer)} · {priceLabel(amount, 'INR', locale)}
          </option>)}
        </select>
      </label>
      <button className="primary-button" disabled={!choice || busy} type="button" onClick={() => void update('schedule')}>{t('schedulePlanChange')}</button>
    </> : <p>{t('noPlanChanges')}</p>)}
  </section>
}
