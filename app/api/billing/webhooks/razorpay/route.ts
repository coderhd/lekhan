/**
 * T8 — Razorpay webhook receiver (thin route, plan T8).
 *
 * Hands the raw request to `services/billing/webhook-processor.ts` and maps the
 * result to an HTTP response. All HMAC verification, raw-recording, read-back
 * and entitlement logic lives in the processor (spec §12 thin-route
 * discipline). The raw body is read as text — the HMAC-SHA256 check is defined
 * over the exact bytes delivered. `X-Razorpay-Event-Id` (when present) is the
 * idempotency key; otherwise the processor derives one from the content.
 */

import { NextRequest, NextResponse } from "next/server"

import { createBillingAdminClient } from "@/lib/billing/workspace-billing"
import { processRazorpayWebhook } from "@/services/billing/webhook-processor"

export async function POST(request: NextRequest): Promise<NextResponse> {
	const rawBody = await request.text()
	const signature = request.headers.get("x-razorpay-signature") ?? ""
	const eventId = request.headers.get("x-razorpay-event-id") ?? ""

	const result = await processRazorpayWebhook({
		db: createBillingAdminClient(),
		rawBody,
		signature,
		eventId,
	})

	if (result.code === "unverified") {
		return NextResponse.json({ error: "Webhook signature verification failed.", code: result.code }, { status: result.status })
	}
	if (result.code === "webhook_config" || result.code === "processing_failed") {
		// Detail is server-side only (PII-minimized): never echo payload content.
		console.error("[billing/webhooks/razorpay] processing failed", result.detail)
		return NextResponse.json({ error: "Webhook processing failed.", code: result.code }, { status: result.status })
	}
	return NextResponse.json({ received: true, code: result.code }, { status: result.status })
}
