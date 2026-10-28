/**
 * T13 — workspace ownership transfer (US-8, PDEC-11, TL A6).
 *
 * A transfer moves the billing root (`workspaces.owner_id`) without touching the
 * `workspace_plans` row, so the workspace keeps its plan for the paid period.
 * The outgoing owner's auto-billing MUST be stopped before the transfer can
 * complete, and that stop is **verified by provider read-back** — never inferred
 * from a payload, a timer, or webhook absence:
 *
 *  - Stripe: after `cancelAtPeriodEnd`, the subscription read-back must report
 *    `cancel_at_period_end === true`; otherwise the transfer fails closed.
 *  - Razorpay: the provider never echoes `cancel_at_cycle_end` on GET (SIL-56
 *    R-CANCEL-FLAG). Verification there is the provider-acknowledged cancel
 *    instruction (2xx) persisted to `workspace_plans.cancel_at_period_end`; the
 *    accepted action is the same provenance the checkout gate already trusts.
 *
 * Two-step, no silent takeover:
 *  1. `initiateOwnershipTransfer` — owner-only; verifies + stops the outgoing
 *     subscription and returns a short-lived signed token for the successor.
 *  2. `acceptOwnershipTransfer` — the signed-in successor presents the token;
 *     the service re-verifies the detaching state and performs an ATOMIC
 *     conditional `owner_id` swap (`WHERE id = ? AND owner_id = ?`), so a replay
 *     or a racing transfer can never take over twice.
 *
 * Content is never deleted: pages, memberships and history stay on the workspace.
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
	classifySubscription,
	withStoredCancelFlag,
	type GatewaySubscriptionState,
	type Rail,
	type SubscriptionLifecycle,
} from "@/lib/billing/gateway"
import { gatewayForRail } from "@/lib/billing/gateway-factory"

/** The successor has a week to sign in and accept — long enough for a handover. */
export const TRANSFER_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type OwnershipTransferErrorCode =
	| "transfer_not_configured"
	| "not_workspace_owner"
	| "successor_not_found"
	| "successor_is_owner"
	| "successor_owns_workspace"
	| "subscription_state_unverified"
	| "detach_unverified"
	| "subscription_not_detached"
	| "invalid_token"
	| "token_expired"
	| "wrong_recipient"
	| "transfer_conflict"

export class OwnershipTransferError extends Error {
	readonly code: OwnershipTransferErrorCode
	readonly status: number

	constructor(code: OwnershipTransferErrorCode, message: string, status = 400) {
		super(message)
		this.name = "OwnershipTransferError"
		this.code = code
		this.status = status
	}
}

export interface TransferTokenPayload {
	v: 1
	workspaceId: string
	fromUserId: string
	toUserId: string
	exp: number
}

export interface InitiateTransferInput {
	workspaceId: string
	actingUserId: string
	successorUserId: string
}

export interface InitiateTransferResult {
	token: string
	expiresAt: string
	/** What the pre-completion stop left behind for the outgoing subscription. */
	outgoingSubscription: SubscriptionLifecycle | "none"
}

export interface AcceptTransferInput {
	token: string
	actingUserId: string
}

export interface AcceptTransferResult {
	workspaceId: string
	previousOwnerId: string
	ownerId: string
	/** `workspace_plans` is keyed by workspace, so the plan survives by construction. */
	planPreserved: true
	tier: string | null
}

interface WorkspaceRow {
	id: string
	owner_id: string
}

interface PlanRow {
	gateway: Rail | "none"
	gateway_subscription_id: string | null
	cancel_at_period_end: boolean | null
	tier?: string | null
}

function transferSecret(): string {
	const secret = process.env.BILLING_TRANSFER_TOKEN_SECRET
	if (!secret || secret.length < 16) {
		throw new OwnershipTransferError(
			"transfer_not_configured",
			"Ownership transfer is not configured on this deployment.",
			503,
		)
	}
	return secret
}

function sign(payload: string): string {
	return createHmac("sha256", transferSecret()).update(payload).digest("base64url")
}

export function issueTransferToken(
	payload: Omit<TransferTokenPayload, "v" | "exp">,
	ttlMs = TRANSFER_TOKEN_TTL_MS,
	now = Date.now(),
): { token: string; expiresAt: string } {
	const full: TransferTokenPayload = { v: 1, ...payload, exp: now + ttlMs }
	const encoded = Buffer.from(JSON.stringify(full), "utf8").toString("base64url")
	return {
		token: `${encoded}.${sign(encoded)}`,
		expiresAt: new Date(full.exp).toISOString(),
	}
}

export function parseTransferToken(token: string, now = Date.now()): TransferTokenPayload {
	const [encoded, signature] = token.split(".")
	if (!encoded || !signature) {
		throw new OwnershipTransferError("invalid_token", "This transfer link is not valid.")
	}

	let expected: string
	try {
		expected = sign(encoded)
	} catch (err) {
		if (err instanceof OwnershipTransferError) throw err
		throw new OwnershipTransferError("invalid_token", "This transfer link is not valid.")
	}

	const given = Buffer.from(signature)
	const wanted = Buffer.from(expected)
	if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
		throw new OwnershipTransferError("invalid_token", "This transfer link is not valid.")
	}

	let payload: TransferTokenPayload
	try {
		payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TransferTokenPayload
	} catch {
		throw new OwnershipTransferError("invalid_token", "This transfer link is not valid.")
	}

	const shapeIsValid =
		payload?.v === 1 &&
		typeof payload.workspaceId === "string" &&
		typeof payload.fromUserId === "string" &&
		typeof payload.toUserId === "string" &&
		typeof payload.exp === "number"
	if (!shapeIsValid) {
		throw new OwnershipTransferError("invalid_token", "This transfer link is not valid.")
	}
	if (payload.exp <= now) {
		throw new OwnershipTransferError("token_expired", "This transfer link has expired. Ask the owner to send a new one.", 410)
	}
	return payload
}

function unwrap<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T | null {
	if (result.error) {
		// Never echo provider/DB error text to the client; log the detail server-side.
		console.error(`[billing/transfer] ${what} failed:`, result.error)
		throw new OwnershipTransferError("transfer_conflict", "The transfer could not be completed. Please try again.", 500)
	}
	return result.data
}

async function loadWorkspace(db: SupabaseClient, workspaceId: string): Promise<WorkspaceRow> {
	const row = unwrap(
		await db.from("workspaces").select("id, owner_id").eq("id", workspaceId).maybeSingle(),
		"Workspace lookup",
	)
	if (!row) {
		throw new OwnershipTransferError("not_workspace_owner", "Workspace not found.", 404)
	}
	return row as WorkspaceRow
}

async function loadPlan(db: SupabaseClient, workspaceId: string): Promise<PlanRow | null> {
	return unwrap(
		await db
			.from("workspace_plans")
			.select("gateway, gateway_subscription_id, cancel_at_period_end, tier")
			.eq("workspace_id", workspaceId)
			.maybeSingle(),
		"Plan lookup",
	) as PlanRow | null
}

async function readProviderState(plan: PlanRow): Promise<GatewaySubscriptionState | null> {
	if (plan.gateway === "none" || !plan.gateway_subscription_id) return null
	try {
		return await gatewayForRail(plan.gateway).getSubscriptionState(plan.gateway_subscription_id)
	} catch {
		throw new OwnershipTransferError(
			"subscription_state_unverified",
			"Could not verify the outgoing subscription with the payment provider; refusing to transfer.",
			503,
		)
	}
}

function lifecycleOf(plan: PlanRow, state: GatewaySubscriptionState | null): SubscriptionLifecycle | "none" {
	if (!state) return "none"
	return classifySubscription(withStoredCancelFlag(state, plan.gateway as Rail, plan.cancel_at_period_end))
}

/**
 * Owner-only first step. Stops the outgoing auto-billing and returns the token
 * the successor must present. The workspace is NOT mutated yet.
 */
export async function initiateOwnershipTransfer(
	db: SupabaseClient,
	input: InitiateTransferInput,
	now = Date.now(),
): Promise<InitiateTransferResult> {
	// Fail before touching the provider: an unset HMAC secret must never cancel a
	// live subscription and then discover it cannot mint a token.
	transferSecret()
	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	if (!UUID.test(input.successorUserId)) {
		throw new OwnershipTransferError("successor_not_found", "That person does not have a Lekhan account.", 404)
	}

	const workspace = await loadWorkspace(db, input.workspaceId)
	if (workspace.owner_id !== input.actingUserId) {
		throw new OwnershipTransferError("not_workspace_owner", "Only the workspace owner can transfer ownership.", 403)
	}
	if (input.successorUserId === input.actingUserId) {
		throw new OwnershipTransferError("successor_is_owner", "You already own this workspace.")
	}

	const successor = unwrap(
		await db.from("profiles").select("id").eq("id", input.successorUserId).maybeSingle(),
		"Successor lookup",
	)
	if (!successor) {
		throw new OwnershipTransferError("successor_not_found", "That person does not have a Lekhan account.", 404)
	}

	// `workspaces.owner_id` is UNIQUE: a user can hold at most one workspace at H0.
	const successorWorkspace = unwrap(
		await db.from("workspaces").select("id").eq("owner_id", input.successorUserId).maybeSingle(),
		"Successor workspace lookup",
	)
	if (successorWorkspace) {
		throw new OwnershipTransferError(
			"successor_owns_workspace",
			"That person already owns a workspace, so they cannot take over this one.",
			409,
		)
	}

	const plan = await loadPlan(db, input.workspaceId)
	let outgoing: SubscriptionLifecycle | "none" = "none"

	if (plan && plan.gateway !== "none" && plan.gateway_subscription_id) {
		const state = await readProviderState(plan)
		if (!state) {
			outgoing = "none"
		} else {
			const lifecycle = lifecycleOf(plan, state)
			if (lifecycle === "live") {
				// Pre-completion stop of the old owner's auto-billing.
				try {
					await gatewayForRail(plan.gateway).cancelAtPeriodEnd(plan.gateway_subscription_id)
				} catch {
					throw new OwnershipTransferError(
						"detach_unverified",
						"Could not stop the outgoing subscription with the payment provider; the transfer was not started.",
						502,
					)
				}

				if (plan.gateway === "razorpay") {
					// SIL-56: Razorpay never echoes the flag; the accepted cancel instruction
					// is the verified record. Persist it so the checkout gate sees detaching.
					const { error } = await db
						.from("workspace_plans")
						.update({ cancel_at_period_end: true })
						.eq("workspace_id", input.workspaceId)
					if (error) {
						throw new OwnershipTransferError(
							"detach_unverified",
							"The provider accepted the cancellation but it could not be recorded; refusing to transfer.",
							500,
						)
					}
					outgoing = "detaching"
				} else {
					// Stripe: provider read-back is the ONLY proof the stop took effect.
					const verified = await readProviderState(plan)
					if (!verified || classifySubscription(verified) !== "detaching") {
						throw new OwnershipTransferError(
							"detach_unverified",
							"The provider did not confirm the outgoing subscription is detaching; the transfer was not started.",
							502,
						)
					}
					outgoing = "detaching"
				}
			} else {
				outgoing = lifecycle
			}
		}
	}

	const { token, expiresAt } = issueTransferToken(
		{
			workspaceId: input.workspaceId,
			fromUserId: workspace.owner_id,
			toUserId: input.successorUserId,
		},
		TRANSFER_TOKEN_TTL_MS,
		now,
	)

	return { token, expiresAt, outgoingSubscription: outgoing }
}

/** Successor-only second step: re-verify + atomic owner swap. */
export async function acceptOwnershipTransfer(
	db: SupabaseClient,
	input: AcceptTransferInput,
	now = Date.now(),
): Promise<AcceptTransferResult> {
	const payload = parseTransferToken(input.token, now)
	if (payload.toUserId !== input.actingUserId) {
		throw new OwnershipTransferError(
			"wrong_recipient",
			"This transfer was addressed to a different account. Sign in as the invited successor.",
			403,
		)
	}

	const workspace = await loadWorkspace(db, payload.workspaceId)
	if (workspace.owner_id !== payload.fromUserId) {
		throw new OwnershipTransferError(
			"transfer_conflict",
			"This workspace changed owners since the transfer was created.",
			409,
		)
	}

	// Re-check at completion: the outgoing subscription must still be detaching.
	const plan = await loadPlan(db, payload.workspaceId)
	if (plan && plan.gateway !== "none" && plan.gateway_subscription_id) {
		const state = await readProviderState(plan)
		if (state && lifecycleOf(plan, state) === "live") {
			throw new OwnershipTransferError(
				"subscription_not_detached",
				"The outgoing subscription is still billing. Cancel it before accepting the transfer.",
				409,
			)
		}
	}

	// Atomic, replay-safe: only the current owner can be replaced, exactly once.
	const updateResult = await db
		.from("workspaces")
		.update({ owner_id: payload.toUserId })
		.eq("id", payload.workspaceId)
		.eq("owner_id", payload.fromUserId)
		.select("id")

	if (updateResult.error?.code === "23505") {
		// `workspaces.owner_id` is UNIQUE (H0: one workspace per user).
		throw new OwnershipTransferError(
			"successor_owns_workspace",
			"The successor already owns a workspace and cannot take over this one.",
			409,
		)
	}
	const updated = unwrap(updateResult, "Ownership update") as Array<{ id: string }> | null

	if (!updated || updated.length === 0) {
		throw new OwnershipTransferError(
			"transfer_conflict",
			"The workspace owner changed before this transfer completed.",
			409,
		)
	}

	// BLOCKING-1 from clean-room review: the subscription ref must stay (it carries the
	// paid remainder to the workspace), but the predecessor's PAYMENT IDENTITY must not
	// follow them. Clearing `gateway_customer_id` makes the portal fail closed for the
	// successor instead of opening the old owner's saved cards/invoices. The new owner's
	// own customer record is created by their next checkout; T8 replaces the subscription
	// ref on activation.
	if (plan && plan.gateway !== "none") {
		const { error: identityError } = await db
			.from("workspace_plans")
			.update({ gateway_customer_id: null })
			.eq("workspace_id", payload.workspaceId)
		if (identityError) {
			// Ownership has already moved; never hide that. Log loudly for ops/reconcile.
			console.error(
				"[billing/transfer] owner swapped but predecessor payment identity could not be cleared:",
				identityError,
			)
		}
	}

	return {
		workspaceId: payload.workspaceId,
		previousOwnerId: payload.fromUserId,
		ownerId: payload.toUserId,
		planPreserved: true,
		tier: plan?.tier ?? null,
	}
}
