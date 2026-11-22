import { receiveBillingWebhook } from '@/lib/billing/webhooks'

export function POST(request: Request) {
  return receiveBillingWebhook(request, 'stripe')
}
