'use client'

import NextLink from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { billingMeasurement, track } from '@/lib/analytics'
import { priceLabel, readOffer, unitAmount, type Currency, type Cycle, type PaidTier } from '@/lib/billing/catalog'
import { useLocale, useTranslations } from '@/lib/i18n/client'

const tierNames: Record<PaidTier, string> = { plus: 'Plus', pro: 'Pro', team: 'Team' }

const paidPlans = [
  { tier: 'plus', features: ['cloudSync', 'plusHistory'] },
  { tier: 'pro', features: ['cloudSync', 'yearHistory'] },
  { tier: 'team', features: ['yearHistory', 'teamSeats'] },
] as const

export default function MarketingPlans({
  signedIn,
  defaultCurrency,
  available,
}: {
  signedIn: boolean
  defaultCurrency: Currency
  available: string[]
}) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('billing')
  const marketing = useTranslations('marketing')
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [cycle, setCycle] = useState<Cycle>('monthly')
  const [seats, setSeats] = useState(2)
  const [busyTier, setBusyTier] = useState<PaidTier | null>(null)
  const [error, setError] = useState<string | null>(null)

  function billingPath(tier: PaidTier) {
    const params = new URLSearchParams({ tier, cycle, currency })
    if (tier === 'team') params.set('seats', String(Math.max(2, seats)))
    return '/billing?' + params.toString()
  }

  async function choosePlan(tier: PaidTier) {
    const offer = readOffer({ tier, cycle, currency, seats })
    if (!offer) {
      setError(t('invalidOffer'))
      return
    }
    const target = billingPath(tier)
    const offerKey = `${offer.currency}:${offer.tier}:${offer.cycle}`
    if (!signedIn || !available.includes(offerKey)) {
      track('upgrade_clicked', offer.tier, offer.cycle, offer.currency)
      router.push(target)
      return
    }
    if (busyTier) return
    setBusyTier(tier)
    setError(null)
    track('upgrade_clicked', offer.tier, offer.cycle, offer.currency)
    try {
      const measurement = await billingMeasurement()
      const response = await fetch('/api/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkout', ...offer, measurement }),
      })
      const result = await response.json()
      if (response.ok && result.url) {
        track('checkout_started', offer.tier, offer.cycle, offer.currency)
        window.location.assign(result.url)
        return
      }
      router.push(target)
    } catch {
      router.push(target)
    } finally {
      setBusyTier(null)
    }
  }

  return (
    <section id="pricing" className="marketing-pricing marketing-width" aria-labelledby="pricing-title">
      <VStack gap={5}>
        <HStack justify="between" align="end" wrap="wrap" gap={4}>
          <VStack gap={2} maxWidth={620}>
            <Heading level={2} id="pricing-title" type="display-2">{marketing('pricingTitle')}</Heading>
            <Text color="secondary">{marketing('pricingIntro')}</Text>
          </VStack>
          <HStack gap={3} wrap="wrap" align="center">
            <SegmentedControl
              label={t('period')}
              value={cycle}
              onChange={value => setCycle(value === 'annual' ? 'annual' : 'monthly')}
              size="sm"
            >
              <SegmentedControlItem value="monthly" label={t('monthly')} />
              <SegmentedControlItem value="annual" label={t('annual')} />
            </SegmentedControl>
            <SegmentedControl
              label={t('currency')}
              value={currency}
              onChange={value => setCurrency(value === 'INR' ? 'INR' : 'USD')}
              size="sm"
            >
              <SegmentedControlItem value="USD" label="USD" />
              <SegmentedControlItem value="INR" label="INR" />
            </SegmentedControl>
          </HStack>
        </HStack>

        {error && (
          <Banner
            status="error"
            collapsible={false}
            isDismissable
            title={error}
            onDismiss={() => setError(null)}
          />
        )}

        <Grid columns={{ minWidth: 250, max: 4 }} gap={4} width="100%">
          <Card padding={5} elevation="low">
            <VStack gap={4} height="100%" justify="between">
              <VStack gap={3}>
                <VStack gap={1}>
                  <Heading level={3}>{t('free')}</Heading>
                  <Text type="display-3" weight="semibold">{priceLabel(0, currency, locale)}</Text>
                  <Text type="supporting" color="secondary">{t('localUnlimited')}</Text>
                </VStack>
                <ul className="marketing-plan-features">
                  <li><Check size={15} aria-hidden="true" /><span>{marketing('moveFolders')}</span></li>
                  <li><Check size={15} aria-hidden="true" /><span>{marketing('moveExport')}</span></li>
                  <li><Check size={15} aria-hidden="true" /><span>{marketing('aiTitle')}</span></li>
                </ul>
              </VStack>
              <Button
                as={NextLink}
                href="/workspace"
                variant="secondary"
                width="100%"
                label={marketing('freeStart')}
                endContent={<ArrowRight size={15} aria-hidden="true" />}
              />
            </VStack>
          </Card>

          {paidPlans.map(({ tier, features }) => {
            const teamInr = tier === 'team' && currency === 'INR'
            const offer = readOffer({ tier, cycle, currency, seats })
            const amount = offer ? unitAmount(offer, false) : null
            const isPopular = tier === 'pro'
            return (
              <Card key={tier} padding={5} elevation={isPopular ? 'med' : 'low'} className={isPopular ? 'marketing-plan-featured' : undefined}>
                <VStack gap={4} height="100%" justify="between">
                  <VStack gap={3}>
                    <VStack gap={1}>
                      <HStack justify="between" align="center" gap={2}>
                        <Heading level={3}>{tierNames[tier]}</Heading>
                        {isPopular && <Text type="supporting" weight="semibold" color="secondary">{marketing('recommended')}</Text>}
                      </HStack>
                      <HStack align="end" gap={1.5} wrap="wrap">
                        <Text type="display-3" weight="semibold">
                          {amount !== null ? priceLabel(amount, currency, locale) : teamInr ? t('usdOnly') : '—'}
                        </Text>
                        {amount !== null && (
                          <Text type="supporting" color="secondary">
                            {tier === 'team'
                              ? t('pricePerSeat', { price: '' }).trim() + t(cycle === 'annual' ? 'perYear' : 'perMonth')
                              : t(cycle === 'annual' ? 'perYear' : 'perMonth')}
                          </Text>
                        )}
                      </HStack>
                    </VStack>

                    {tier === 'team' && !teamInr && (
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
                    )}

                    <ul className="marketing-plan-features">
                      {features.map(feature => (
                        <li key={feature}><Check size={15} aria-hidden="true" /><span>{t(feature)}</span></li>
                      ))}
                    </ul>
                  </VStack>

                  {teamInr ? (
                    <Button
                      type="button"
                      variant="secondary"
                      width="100%"
                      label={t('teamUsd')}
                      onClick={() => setCurrency('USD')}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant={isPopular ? 'primary' : 'secondary'}
                      width="100%"
                      isLoading={busyTier === tier}
                      isDisabled={busyTier !== null && busyTier !== tier}
                      label={busyTier === tier ? t('openingCheckout') : t('chooseTier', { plan: tierNames[tier] })}
                      endContent={<ArrowUpRight size={15} aria-hidden="true" />}
                      onClick={() => void choosePlan(tier)}
                    />
                  )}
                </VStack>
              </Card>
            )
          })}
        </Grid>
      </VStack>
    </section>
  )
}
