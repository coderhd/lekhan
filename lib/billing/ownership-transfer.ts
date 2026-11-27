import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { workspaceTransferPath } from '@/lib/auth/input'
import { cancelProviderSubscription, providerRenewalStopped, razorpaySchedule, scheduleStripeTransferCancellation } from './gateways'
import { BillingError, ownerWorkspace, pendingCheckout, readBillingPlan, withBillingMutation, type billingAccount } from './workspace'

type Context = Awaited<ReturnType<typeof billingAccount>>

const conflicts = new Set([
  'transfer_in_progress', 'transfer_recipient_has_workspace', 'transfer_plan_changed',
  'transfer_checkout_pending', 'transfer_referral_pending',
])

function transferFailure(message: string): never {
  if (conflicts.has(message)) throw new BillingError(message, 409)
  if (message === 'transfer_workspace_not_owned') throw new BillingError(message, 403)
  if (message === 'transfer_invalid_recipient' || message === 'transfer_invalid_link') throw new BillingError(message, 404)
  throw new Error('Could not save workspace ownership transfer')
}

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function inviteWorkspaceOwner({ account, admin, origin }: Context, email: string) {
  const workspace = await ownerWorkspace(account.client, account.subject)
  if (!workspace) throw new BillingError('transfer_workspace_not_owned', 403)
  const token = randomBytes(32).toString('base64url')
  const { data, error } = await admin.rpc('rebuild_invite_workspace_owner', {
    target_workspace: workspace, actor: account.subject, recipient_email: email, digest: tokenDigest(token),
  })
  if (error) transferFailure(error.message)
  return { url: origin + workspaceTransferPath(token), expiresAt: data as string }
}

export async function readWorkspaceTransfer(admin: SupabaseClient, token: string, actor: string) {
  if (!workspaceTransferPath(token)) return null
  const { data, error } = await admin.from('rebuild_workspace_transfers').select('workspace_id,expires_at,accepted_at')
    .eq('token_digest', tokenDigest(token)).eq('successor', actor).maybeSingle<{
      workspace_id: string
      expires_at: string
      accepted_at: string | null
    }>()
  if (error) throw new Error('Could not check workspace ownership transfer')
  if (!data || (!data.accepted_at && Date.parse(data.expires_at) <= Date.now())) return null
  return data
}

export async function acceptWorkspaceOwner({ account, admin }: Context, token: string) {
  const invite = await readWorkspaceTransfer(admin, token, account.subject)
  if (!invite) throw new BillingError('transfer_invalid_link', 404)
  const workspace = await ownerWorkspace(account.client, account.subject)
  if (invite.accepted_at && invite.workspace_id === workspace) return
  if (workspace) throw new BillingError('transfer_recipient_has_workspace', 409)

  const plan = await readBillingPlan(admin, invite.workspace_id)
  if (!plan) throw new BillingError('transfer_plan_changed', 409)
  await withBillingMutation(admin, plan, async lease => {
    const latest = await readWorkspaceTransfer(admin, token, account.subject)
    if (!latest || latest.accepted_at) throw new BillingError('transfer_invalid_link', 404)

    const [checkout, referral] = await Promise.all([
      pendingCheckout(admin, plan.workspace_id),
      admin.from('rebuild_referral_redemptions').select('id').eq('workspace_id', plan.workspace_id)
        .is('settled_at', null).is('abandoned_at', null).maybeSingle(),
    ])
    if (checkout) throw new BillingError('transfer_checkout_pending', 409)
    if (referral.error) throw new Error('Could not check the referral balance')
    if (referral.data) throw new BillingError('transfer_referral_pending', 409)

    const { gateway, gateway_subscription_id: ref } = plan
    if (ref && gateway === 'none') throw new Error('The billing provider is missing')
    if (ref && gateway !== 'none') {
      let stopped = await providerRenewalStopped(gateway, ref, plan.cancel_at_period_end === true)
      if (!stopped) {
        if (plan.status !== 'active') throw new BillingError('transfer_payment_pending', 409)
        if (gateway === 'razorpay' && (await razorpaySchedule(ref)).paymentChange) {
          throw new BillingError('remove_scheduled_change', 409)
        }
        if (gateway === 'stripe') await scheduleStripeTransferCancellation(ref)
        else await cancelProviderSubscription(gateway, ref)
        stopped = await providerRenewalStopped(gateway, ref, true)
        if (gateway === 'razorpay' && stopped) {
          // Persist the acknowledged provider instruction for a retry of this handover.
          const { data, error } = await admin.from('workspace_plans').update({ cancel_at_period_end: true })
            .eq('workspace_id', plan.workspace_id).eq('gateway_subscription_id', ref)
            .eq('rebuild_billing_write_until', lease).select('workspace_id').maybeSingle()
          if (error || !data) throw new BillingError('transfer_plan_changed', 409)
        }
      }
      if (!stopped) throw new BillingError('transfer_renewal_unverified', 503)
    }

    const { error } = await admin.rpc('rebuild_accept_workspace_owner', {
      target_workspace: plan.workspace_id, actor: account.subject, digest: tokenDigest(token),
      expected_revision: plan.rebuild_billing_revision, write_lease: lease, verified_subscription: ref,
    })
    if (error) transferFailure(error.message)
  })
}
