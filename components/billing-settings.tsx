'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Check } from 'lucide-react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { billingMeasurement, bootstrapTierGates, track } from '@/lib/analytics'
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

export default function BillingSettings({ summary, scope = 'personal', defaultCurrency, available, returned, paused, initialCycle, initialTier, initialSeats }: {
  summary: Awaited<ReturnType<typeof readBillingSummary>>
  scope?: string
  defaultCurrency: Currency
  available: string[]
  returned: boolean
  paused: boolean
  initialCycle?: Cycle
  initialTier?: PaidTier
  initialSeats?: number
}) {
  const { pending, entitlement, canManage } = summary
  const locale = useLocale()
  const t = useTranslations('billing')
  const router = useRouter()
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [cycle, setCycle] = useState<Cycle>(initialCycle ?? pending?.cycle ?? 'monthly')
  const [seats, setSeats] = useState<number>(initialSeats ?? (pending?.tier === 'team' ? pending.seats : 2))
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showPlanChanges, setShowPlanChanges] = useState(false)
  const [failure, setFailure] = useState<BillingFailure | null>(null)
  const [notice, setNotice] = useState<BillingNotice | null>(null)
  const founding = summary.checkoutFounding
  const waiting = !!pending || (returned && entitlement?.status !== 'active')

  useEffect(() => {
    bootstrapTierGates(scope, entitlement ? {
      tier: entitlement.tier,
      seats: entitlement.seats,
      relayReadOnly: entitlement.relayReadOnly,
    } : null)
  }, [entitlement, scope])

  useEffect(() => {
    if (!waiting) return
    const interval = window.setInterval(() => router.refresh(), 3000)
    const stop = window.setTimeout(() => window.clearInterval(interval), 21_000)
    return () => { window.clearInterval(interval); window.clearTimeout(stop) }
  }, [waiting, router])

  async function act(action: 'checkout' | 'portal' | 'cancel' | 'check', tier?: PaidTier, usePending = false) {
    const selected = usePending && pending ? pending : { tier, cycle, currency, seats }
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
  return (
    <VStack gap={4}>
      <Card padding={4} elevation="low" className="billing-current" aria-label={t('currentPlan')}>
        <HStack justify="between" align="center" wrap="wrap" gap={3}>
          <VStack gap={0.5}>
            <Text type="supporting" color="secondary">{t('currentPlan')}</Text>
            <Heading level={2}>{!entitlement || entitlement.tier === 'free' ? t('free') : tierNames[entitlement.tier]}</Heading>
          </VStack>
          <VStack gap={0.5}>
            <Text color="secondary">
              {entitlement?.cancelAtPeriodEnd ? (periodEnd ? t('endsOn', { date: periodEnd }) : t('endsAtPeriod'))
                : periodEnd && entitlement?.status === 'active' ? t('renewsOn', { date: periodEnd })
                  : canManage ? t('workspaceSubscription') : t('localUnlimited')}
            </Text>
            {entitlement?.isFounding && <Text type="supporting" weight="semibold">{t('foundingPricing')}</Text>}
          </VStack>
        </HStack>
      </Card>

      {entitlement?.status === 'past_due' && (
        <div role="status">
          <Banner status="warning" collapsible={false} title={entitlement.relayReadOnly ? t('paymentReadOnly') : t('paymentAttention')} />
        </div>
      )}
      {returned && (
        <div role="status">
          <Banner status="info" collapsible={false} title={canManage && !pending ? t('subscriptionReady') : t('awaitingPayment')} />
        </div>
      )}
      {summary.canReattach && (
        <Banner status="info" collapsible={false} title={t('reattach')} />
      )}
      {paused && !canManage && (
        <Banner status="info" collapsible={false} title={t('pausedCheckout')} />
      )}
      {failure && (
        <div role="alert">
          <Banner status="error" collapsible={false} title={t(failure)} />
        </div>
      )}
      {notice && (
        <div role="status">
          <Banner status="info" collapsible={false} title={t(notice)} />
        </div>
      )}

      {canManage ? (
        <VStack gap={3}>
          <HStack gap={2} wrap="wrap" className="billing-actions">
            <Button
              type="button"
              variant="primary"
              isDisabled={!!busy}
              label={t('managePayment')}
              endContent={<ArrowUpRight size={16} />}
              onClick={() => void act('portal')}
            />
            {summary.gateway === 'razorpay' && (
              <Button
                type="button"
                variant="secondary"
                aria-expanded={showPlanChanges}
                isDisabled={!!busy}
                label={t('changePlan')}
                onClick={() => { setConfirmCancel(false); setShowPlanChanges(value => !value) }}
              />
            )}
            {!entitlement?.cancelAtPeriodEnd && (
              <Button
                type="button"
                variant="secondary"
                isDisabled={!!busy}
                label={t('cancelSubscription')}
                onClick={() => setConfirmCancel(value => !value)}
              />
            )}
          </HStack>
          {showPlanChanges && summary.gateway === 'razorpay' && <RazorpayPlanChanges />}
          {confirmCancel && (
            <Card padding={4} className="billing-confirm">
              <VStack gap={3}>
                <Text>{periodEnd ? t('keepsThroughDate', { date: periodEnd }) : t('keepsThroughPeriod')}</Text>
                <HStack gap={2} wrap="wrap">
                  <Button type="button" variant="destructive" isDisabled={!!busy} label={t('confirmCancellation')} onClick={() => void act('cancel')} />
                  <Button type="button" variant="secondary" isDisabled={!!busy} label={t('keepSubscription')} onClick={() => setConfirmCancel(false)} />
                </HStack>
              </VStack>
            </Card>
          )}
        </VStack>
      ) : (
        <VStack gap={4}>
          {pending && (
            <HStack gap={2} wrap="wrap" className="billing-actions">
              <Button
                type="button"
                variant="secondary"
                isDisabled={!!busy}
                label={t('resumeCheckout', { plan: tierNames[pending.tier] })}
                endContent={<ArrowUpRight size={15} />}
                onClick={() => void act('checkout', pending.tier, true)}
              />
              <Button
                type="button"
                variant="secondary"
                isDisabled={!!busy}
                label={busy === 'check' ? t('checkingPayment') : t('checkPayment')}
                onClick={() => void act('check')}
              />
            </HStack>
          )}
          <HStack gap={3} wrap="wrap" className="billing-controls">
            <Selector
              label={t('currency')}
              size="sm"
              value={currency}
              options={[
                { value: 'USD', label: t('usd') },
                { value: 'INR', label: t('inr') },
              ]}
              onChange={value => setCurrency(value === 'INR' ? 'INR' : 'USD')}
            />
            <Selector
              label={t('period')}
              size="sm"
              value={cycle}
              options={[
                { value: 'monthly', label: t('monthly') },
                { value: 'annual', label: t('annual') },
              ]}
              onChange={value => setCycle(value === 'annual' ? 'annual' : 'monthly')}
            />
          </HStack>
          <Grid columns={{ minWidth: 220, max: 3 }} gap={4} className="billing-plans" aria-label={t('paidPlans')}>
            {plans.map(({ tier, features }) => {
              const teamInr = tier === 'team' && currency === 'INR'
              const offer = readOffer({ tier, cycle, currency, seats })
              const amount = offer ? unitAmount(offer, founding) : null
              const enabled = available.includes(`${currency}:${tier}:${cycle}`)
              const isSelected = initialTier === tier
              return (
                <Card
                  key={tier}
                  padding={4}
                  elevation={isSelected ? 'med' : 'low'}
                  className={`billing-plan ${isSelected ? 'is-selected' : ''}`}
                  aria-labelledby={`plan-${tier}`}
                >
                  <VStack gap={3} height="100%" justify="between">
                    <VStack gap={3}>
                      <Heading level={2} id={`plan-${tier}`}>{tierNames[tier]}</Heading>
                      <HStack align="end" gap={1.5} wrap="wrap" className="billing-price">
                        <Text type="display-3" weight="semibold">
                          {amount ? priceLabel(amount, currency, locale) : teamInr ? t('usdOnly') : '—'}
                        </Text>
                        {amount && <Text type="supporting" color="secondary">{t(cycle === 'annual' ? 'perYear' : 'perMonth')}</Text>}
                      </HStack>
                      {tier === 'team' && !teamInr && (
                        <VStack gap={1}>
                          <NumberInput
                            label={t('seats')}
                            size="sm"
                            width="100%"
                            min={2}
                            max={500}
                            isIntegerOnly
                            hasNumberSteppers
                            value={seats}
                            onChange={value => setSeats(Math.max(2, value))}
                          />
                          {offer && (
                            <Text type="supporting" color="secondary">
                              {t('pricePerSeat', { price: priceLabel(unitAmount(offer, founding), currency, locale) })}
                            </Text>
                          )}
                        </VStack>
                      )}
                      <ul className="marketing-plan-features">
                        {features.map(feature => (
                          <li key={feature}><Check size={15} aria-hidden="true" /><span>{t(feature)}</span></li>
                        ))}
                      </ul>
                    </VStack>
                    {teamInr ? (
                      <Button type="button" variant="secondary" width="100%" label={t('teamUsd')} onClick={() => setCurrency('USD')} />
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        width="100%"
                        isLoading={busy === tier}
                        isDisabled={!enabled || !offer || !!busy}
                        label={busy === tier ? t('openingCheckout') : enabled ? t('chooseTier', { plan: tierNames[tier] }) : t('checkoutUnavailable')}
                        endContent={<ArrowUpRight size={15} />}
                        onClick={() => void act('checkout', tier)}
                      />
                    )}
                  </VStack>
                </Card>
              )
            })}
          </Grid>
        </VStack>
      )}
    </VStack>
  )
}
