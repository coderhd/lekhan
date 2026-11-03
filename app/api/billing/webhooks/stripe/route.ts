/**
 * T8 — Stripe webhook receiver (thin route, plan T8).
 *
 * Hands the raw request to `services/billing/webhook-processor.ts` and maps the
 * result to an HTTP response. All verification, raw-recording, read-back and
 * entitlement logic lives in the processor (spec §12 thin-route discipline).
 * The raw body is read as text — Stripe signature verification is defined over
 * the exact bytes delivered.
 */

import { NextRequest, NextResponse } from "next/server"

import { createBillingAdminClient } from "@/lib/billing/workspace-billing"
import { processStripeWebhook } from "@/services/billing/webhook-processor"

export async function POST(request: NextRequest): Promise<NextResponse> {
	const rawBody = await request.text()
	const signature = request.headers.get("stripe-signature") ?? ""

	const result = await processStripeWebhook({
		db: createBillingAdminClient(),
		rawBody,
		signature,
	})

	if (result.code === "unverified") {
		return NextResponse.json({ error: "Webhook signature verification failed.", code: result.code }, { status: result.status })
	}
	if (result.code === "webhook_config" || result.code === "processing_failed") {
		// Detail is server-side only (PII-minimized): never echo payload content.
		console.error("[billing/webhooks/stripe] processing failed", result.detail)
		return NextResponse.json({ error: "Webhook processing failed.", code: result.code }, { status: result.status })
	}
	return NextResponse.json({ received: true, code: result.code }, { status: result.status })
}
