import 'server-only'

import { createHash } from 'node:crypto'
import { unitAmount, type Cycle, type Offer } from './catalog'
import {
  cancelRazorpayPlanChange, configuredPrice, findConfiguredOffer, razorpaySchedule, scheduleRazorpayPlan, verifyCheckoutPrice,
} from './gateways'
import { BillingError, ownerWorkspace, readBillingPlan, withBillingMutation, type billingAccount } from './workspace'

type Owner = Awaited<ReturnType<typeof billingAccount>>
type PlanChangeRequest = { action: 'schedule'; offer: Offer } | { action: 'remove'; key: string }
type ScheduledInfo = Awaited<ReturnType<typeof razorpaySchedule>>

async function razorpayPlan({ account, admin }: Owner) {
  const workspace = await ownerWorkspace(account.client, account.subject)
  const plan = workspace && await readBillingPlan(admin, workspace)
  if (!plan || plan.gateway !== 'razorpay' || !plan.gateway_subscription_id || plan.status === 'canceled' ||
    plan.rebuild_successor_founding != null) {
    throw new BillingError('no_subscription', 404)
  }
  return { plan, ref: plan.gateway_subscription_id, founding: plan.is_founding === true }
}

function scheduledChange(ref: string, paymentChange: ScheduledInfo['paymentChange'], founding: boolean) {
  if (!paymentChange) return null
  const { priceId, effectiveAt } = paymentChange
  const offer = findConfiguredOffer('razorpay', priceId, 1, founding)
  return {
    key: createHash('sha256').update(JSON.stringify([ref, priceId, effectiveAt])).digest('hex'),
    offer,
    effectiveAt,
  }
}

export async function readPlanChanges(owner: Owner) {
  const { plan, ref, founding } = await razorpayPlan(owner)
  const current = await razorpaySchedule(ref)
  const scheduled = scheduledChange(ref, current.paymentChange, founding)
  const options = []
  if (current.active && !plan.cancel_at_period_end && !scheduled) {
    const cycles: Cycle[] = ['monthly', 'annual']
    for (const tier of ['plus', 'pro'] as const) {
      for (const cycle of cycles) {
        const offer = { tier, cycle, currency: 'INR', seats: 1 } as const
        const id = configuredPrice(offer, founding)
        if (id && id !== current.currentPrice) options.push({ offer, amount: unitAmount(offer, founding) })
      }
    }
  }
  return { scheduled, options }
}

export async function changeRazorpayPlan(owner: Owner, request: PlanChangeRequest) {
  const { admin } = owner
  const { plan, ref, founding } = await razorpayPlan(owner)
  return withBillingMutation(admin, plan, async () => {
    const current = await razorpaySchedule(ref)
    const scheduled = scheduledChange(ref, current.paymentChange, founding)
    if (request.action === 'remove') {
      if (!scheduled || scheduled.key !== request.key) throw new BillingError('scheduled_change_updated', 409)
      await cancelRazorpayPlanChange(ref)
      if ((await razorpaySchedule(ref)).paymentChange) throw new Error('Razorpay has not confirmed the cancellation')
      return
    }

    if (!current.active || plan.cancel_at_period_end) throw new BillingError('subscription_not_changeable', 409)
    const { offer } = request
    const priceId = configuredPrice(offer, founding)
    if (!priceId) throw new BillingError('price_unavailable', 503)
    if (scheduled) {
      if (current.paymentChange?.priceId === priceId) return
      throw new BillingError('remove_scheduled_change', 409)
    }
    if (offer.currency !== 'INR' || offer.tier === 'team' || current.currentPrice === priceId) {
      throw new BillingError('invalid_offer', 400)
    }
    await verifyCheckoutPrice(offer, founding, priceId)
    if (!await scheduleRazorpayPlan(ref, priceId)) throw new BillingError('payment_method_cannot_change_plan', 422)
    if ((await razorpaySchedule(ref)).paymentChange?.priceId !== priceId) throw new Error('Razorpay has not confirmed the plan change')
  })
}
