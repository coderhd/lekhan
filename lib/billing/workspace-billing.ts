/**
 * T5 — server-only workspace billing context for the currency-agnostic route
 * wrappers (checkout / portal / cancel).
 *
 * Keeps the route handlers thin (spec §12): request auth, owner-only workspace
 * resolution, and the `workspace_plans` read live here. Reads run through the
 * Supabase service-role client, the same pattern as every other server
 * integration in this repo (`app/api/ai/route.ts:130-134`).
 *
 * Owner-only resolution: the workspace is resolved by `owner_id = requester`, so
 * a caller can only ever act on their own workspace — never a workspace id
 * supplied by the client.
 */

import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Currency, Rail } from "./gateway"

export interface WorkspacePlanRow {
	workspace_id: string
	tier: string
	gateway: Rail | "none"
	gateway_customer_id: string | null
	gateway_subscription_id: string | null
	currency: Currency | null
	is_founding: boolean
	cancel_at_period_end?: boolean
}

export interface OwnerBillingContext {
	workspaceId: string
	plan: WorkspacePlanRow | null
}

export class BillingContextError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code: string,
	) {
		super(message)
		this.name = "BillingContextError"
	}
}

function supabaseEnv(): { url: string; anonKey: string; serviceKey: string } {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
	const anonKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		""
	const serviceKey =
		process.env.SUPABASE_SECRET_KEY ||
		process.env.SUPABASE_SERVICE_ROLE_KEY ||
		anonKey
	return { url, anonKey, serviceKey }
}

/** Resolves the authenticated user id from the request's Bearer token, or null. */
export async function getRequestUserId(request: Request): Promise<string | null> {
	const header = request.headers.get("authorization")
	if (!header || !header.toLowerCase().startsWith("bearer ")) return null
	const token = header.slice(7).trim()
	if (!token) return null

	const { url, anonKey } = supabaseEnv()
	const client = createClient(url, anonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
	})
	const { data } = await client.auth.getUser()
	return data?.user?.id ?? null
}

/** Service-role client for billing reads/writes (never exposed to the browser). */
export function createBillingAdminClient(): SupabaseClient {
	const { url, serviceKey } = supabaseEnv()
	return createClient(url, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { apikey: serviceKey } },
	})
}

/**
 * Resolves the requester's own workspace plus its `workspace_plans` row (or null
 * when the workspace has not been backfilled yet). Query errors propagate.
 */
export async function resolveOwnerBilling(
	client: SupabaseClient,
	userId: string,
): Promise<OwnerBillingContext> {
	const { data: workspace, error: workspaceError } = await client
		.from("workspaces")
		.select("id")
		.eq("owner_id", userId)
		.maybeSingle()

	if (workspaceError) {
		throw new BillingContextError(500, `Workspace lookup failed: ${workspaceError.message}`, "workspace_lookup_failed")
	}
	if (!workspace) {
		throw new BillingContextError(404, "No workspace found for this account.", "no_workspace")
	}

	const { data: plan, error: planError } = await client
		.from("workspace_plans")
		.select("*")
		.eq("workspace_id", workspace.id)
		.maybeSingle()

	if (planError) {
		throw new BillingContextError(500, `Plan lookup failed: ${planError.message}`, "plan_lookup_failed")
	}

	return { workspaceId: workspace.id as string, plan: (plan as WorkspacePlanRow | null) ?? null }
}

/** Maps a billing-context failure to its HTTP response; unknown errors fail closed as 500. */
export function billingContextErrorResponse(err: unknown): NextResponse {
	if (err instanceof BillingContextError) {
		return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
	}
	console.error("[billing] context resolution failed:", err)
	return NextResponse.json({ error: "Billing service unavailable.", code: "billing_unavailable" }, { status: 500 })
}
