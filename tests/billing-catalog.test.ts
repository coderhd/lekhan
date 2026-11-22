import { expect, it } from 'vitest'
import { readOffer, unitAmount, type Offer } from '../lib/billing/catalog'

it('rejects unsupported currencies and non-integer team seat counts', () => {
  expect(readOffer({ tier: 'team', currency: 'INR', cycle: 'monthly', seats: 2 })).toBeNull()
  expect(readOffer({ tier: 'team', currency: 'USD', cycle: 'monthly', seats: 2.5 })).toBeNull()
  expect(readOffer({ tier: 'team', currency: 'USD', cycle: 'monthly', seats: 1 })).toBeNull()
  expect(readOffer({ tier: 'free', currency: 'USD', cycle: 'monthly' })).toBeNull()
  expect(readOffer({ tier: 'plus', currency: 'INR', cycle: 'annual', seats: 4, amount: 100, founding: true }))
    .toEqual({ tier: 'plus', currency: 'INR', cycle: 'annual', seats: 1 })
})

it('honors the approved regional prices and per-seat volume boundaries', () => {
  const plus: Offer = { tier: 'plus', currency: 'INR', cycle: 'annual', seats: 1 }
  expect(unitAmount(plus, true)).toBe(249900)
  expect(unitAmount(plus, false)).toBe(499000)

  const team: Offer = { tier: 'team', currency: 'USD', cycle: 'annual', seats: 2 }
  expect([2, 10, 11, 25, 26].map(seats => unitAmount({ ...team, seats }, true)))
    .toEqual([8000, 8000, 7000, 7000, 6000])
  expect([2, 10, 11, 25, 26].map(seats => unitAmount({ ...team, seats }, false)))
    .toEqual([10000, 10000, 9000, 9000, 8000])
})
