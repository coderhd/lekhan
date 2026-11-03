import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * T10 — `GET/POST /api/cron/billing-reconcile` guard rails (plan T10, PDEC-7).
 *
 * The CRON_SECRET Bearer pattern is copied verbatim from retention-prune
 * (`app/api/cron/retention-prune/route.ts:15-23`): header-only auth, query-string
 * attempts rejected, and partial failures answered 500 so the scheduler run is
 * observably unhealthy. Sweep behavior is pinned in billing-reconciliation.test.ts.
 */

const OK_SUMMARY = {
	scanned: 2,
	checked: 1,
	converged: 1,
	unchanged: 0,
	skippedFresh: 1,
	gone: 0,
	failures: 0,
	referralsSettled: 1,
	results: [],
}

function authorizedRequest(method = "POST") {
	return new NextRequest("http://localhost:3000/api/cron/billing-reconcile", {
		method,
		headers: { authorization: "Bearer test-cron-secret-key-123" },
	})
}

describe("/api/cron/billing-reconcile", () => {
	beforeEach(() => {
		vi.resetModules()
		vi.restoreAllMocks()
		process.env.CRON_SECRET = "test-cron-secret-key-123"
		process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co"
		process.env.SUPABASE_SECRET_KEY = "mock-secret-key"
	})

	it("returns 401 when the Bearer token is missing or invalid", async () => {
		const { POST } = await import("@/app/api/cron/billing-reconcile/route")
		const req = new NextRequest("http://localhost:3000/api/cron/billing-reconcile", {
			method: "POST",
			headers: { authorization: "Bearer wrong-token" },
		})

		const res = await POST(req)
		expect(res.status).toBe(401)
		expect((await res.json()).error).toBe("Unauthorized")
	})

	it("rejects authentication attempts using query parameters", async () => {
		const { GET } = await import("@/app/api/cron/billing-reconcile/route")
		const req = new NextRequest(
			"http://localhost:3000/api/cron/billing-reconcile?secret=test-cron-secret-key-123",
			{ method: "GET" },
		)

		const res = await GET(req)
		expect(res.status).toBe(401)
	})

	it("runs the sweep when authorized with the exact CRON_SECRET Bearer", async () => {
		const reconcile = vi.fn(async () => OK_SUMMARY)
		vi.doMock("@/services/billing/reconciliation", () => ({ reconcileBilling: reconcile }))
		vi.doMock("@supabase/supabase-js", () => ({
			createClient: vi.fn(() => ({ from: vi.fn() })),
		}))

		const { POST } = await import("@/app/api/cron/billing-reconcile/route")
		const res = await POST(authorizedRequest())

		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toMatchObject({ success: true, checked: 1, referralsSettled: 1, failures: 0 })
		expect(reconcile).toHaveBeenCalledTimes(1)
	})

	it("answers 500 (unhealthy run) when any workspace failed to converge", async () => {
		const reconcile = vi.fn(async () => ({
			...OK_SUMMARY,
			converged: 0,
			checked: 2,
			failures: 1,
			results: [{ workspaceId: "ws-1", rail: "stripe", outcome: "provider-error", detail: "provider read-back failed" }],
		}))
		vi.doMock("@/services/billing/reconciliation", () => ({ reconcileBilling: reconcile }))
		vi.doMock("@supabase/supabase-js", () => ({
			createClient: vi.fn(() => ({ from: vi.fn() })),
		}))

		const { GET } = await import("@/app/api/cron/billing-reconcile/route")
		const res = await GET(authorizedRequest("GET"))

		expect(res.status).toBe(500)
		const body = await res.json()
		expect(body).toMatchObject({ success: false, error: "Partial billing reconciliation failure", failures: 1 })
	})
})
