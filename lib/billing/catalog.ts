export type Currency = 'USD' | 'INR'
export type PaidTier = 'plus' | 'pro' | 'team'
export type Cycle = 'monthly' | 'annual'

export interface Offer {
  tier: PaidTier
  cycle: Cycle
  currency: Currency
  seats: number
}

const prices = {
  USD: {
    plus: { founding: [400, 4000], standard: [600, 6000] },
    pro: { founding: [800, 8000], standard: [1200, 12000] },
  },
  INR: {
    plus: { founding: [24900, 249900], standard: [49900, 499000] },
    pro: { founding: [49900, 499900], standard: [99900, 999000] },
  },
} as const

export const teamBands = [
  { through: 10, founding: 800, standard: 1000 },
  { through: 25, founding: 700, standard: 900 },
  { through: null, founding: 600, standard: 800 },
] as const

export function readOffer(value: unknown): Offer | null {
  if (!value || typeof value !== 'object') return null
  const { tier, cycle, currency, seats } = value as Record<string, unknown>
  if (tier !== 'plus' && tier !== 'pro' && tier !== 'team') return null
  if (cycle !== 'monthly' && cycle !== 'annual') return null
  if (currency !== 'USD' && currency !== 'INR') return null
  if (tier !== 'team') return { tier, cycle, currency, seats: 1 }
  if (currency === 'INR' || typeof seats !== 'number' || !Number.isInteger(seats) || seats < 2 || seats > 2_147_483_647) return null
  return { tier, cycle, currency, seats }
}

export function unitAmount(offer: Offer, founding: boolean) {
  const cohort = founding ? 'founding' : 'standard'
  if (offer.tier === 'team') {
    const band = teamBands.find(item => item.through === null || offer.seats <= item.through)!
    return band[cohort] * (offer.cycle === 'annual' ? 10 : 1)
  }
  return prices[offer.currency][offer.tier][cohort][offer.cycle === 'annual' ? 1 : 0]
}

export function priceLabel(amount: number, currency: Currency, locale: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount / 100)
}
