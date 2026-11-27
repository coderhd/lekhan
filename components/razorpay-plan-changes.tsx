'use client'

import { useEffect, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
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

  return (
    <Card padding={4} className="billing-confirm billing-plan-changes" aria-label={t('planChanges')}>
      <VStack gap={3} align="start">
        {error && <div role="alert" style={{ width: '100%' }}><Banner status="error" collapsible={false} title={t(error)} /></div>}
        {notice && <div role="status" style={{ width: '100%' }}><Banner status="success" collapsible={false} title={t(notice)} /></div>}
        {!changes && !error && <Text type="supporting" role="status">{t('checkingSubscription')}</Text>}
        {scheduled && (
          <>
            <Text>
              <strong>{scheduled.offer ? planLabel(scheduled.offer) : t('scheduledChange')}</strong>
              {' · '}{scheduled.effectiveAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(scheduled.effectiveAt)) : t('atRenewal')}
            </Text>
            <Button type="button" variant="secondary" size="sm" isDisabled={busy} label={t('cancelPlanChange')} onClick={() => void update('remove')} />
          </>
        )}
        {!scheduled && changes && (changes.options.length ? (
          <>
            <Text color="secondary">{t('newPlanStarts')}</Text>
            <Selector
              label={t('newPlan')}
              placeholder={t('choosePlan')}
              isDisabled={busy}
              width="100%"
              value={selected}
              options={changes.options.map(({ offer, amount }) => ({
                value: offer.tier + ':' + offer.cycle,
                label: `${planLabel(offer)} · ${priceLabel(amount, 'INR', locale)}`,
              }))}
              onChange={setSelected}
            />
            <Button type="button" variant="primary" isDisabled={!choice || busy} label={t('schedulePlanChange')} onClick={() => void update('schedule')} />
          </>
        ) : <Text color="secondary">{t('noPlanChanges')}</Text>)}
      </VStack>
    </Card>
  )
}
