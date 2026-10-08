import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * T7 — Razorpay rail.
 *
 * Pins (plan T7 / spec §5, §13, PDEC-1, PDEC-8, PDEC-12, TL R-1):
 *  - createCheckout request shape: plan/cycle/cohort resolved from env only,
 *    `total_count`/`customer_notify`/`notes.workspace_id`, hosted `short_url`
 *  - cancel-at-cycle-end semantics
 *  - scheduled plan-change surface (schedule + retrieve + cancel mapping)
 *  - seam honesty: no Stripe-style portal session — `portalUrl` returns the
 *    hosted card-update link and makes no provider call
 *  - read-back status/period mapping used by the invariant + webhook processors
 *  - Basic-auth HTTP client fails closed on missing credentials
 */

import {
	UnsupportedCurrencyError,
	classifySubscription,
	type Rail,
} from "@/lib/billing/gateway"
import { PriceConfigError } from "@/lib/billing/prices"
import { gatewayForRail } from "@/lib/billing/gateway-factory"
import {
	RAZORPAY_API_BASE,
	RazorpayConfigError,
	createRazorpayGateway,
	createRazorpayHttpClient,
	type RazorpayHttpClient,
	type RazorpayHttpRequest,
} from "@/lib/billing/razorpay"

const PLAN = {
	plusMonthlyGa: "plan_plus_monthly_ga",
	plusMonthlyFounding: "plan_plus_monthly_founding",
	proAnnualGa: "plan_pro_annual_ga",
	proAnnualFounding: "plan_pro_annual_founding",
}

const ENV_KEYS = [
	"RAZORPAY_KEY_ID",
	"RAZORPAY_KEY_SECRET",
	"RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR",
	"RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_GA_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_FOUNDING_INR",
] as const

interface RecordedCall {
	method: string
	path: string
	body?: unknown
}

/** Deterministic test double for the provider: records calls, replays queued responses. */
function recordingClient(responses: Array<unknown | Error>): {
	client: RazorpayHttpClient
	calls: RecordedCall[]
} {
	const calls: RecordedCall[] = []
	let index = 0
	const client: RazorpayHttpClient = {
		async request<T>(req: RazorpayHttpRequest): Promise<T> {
			calls.push({ method: req.method, path: req.path, body: req.body })
			const next = responses[index++]
			if (next === undefined) throw new Error(`unexpected request: ${req.method} ${req.path}`)
			if (next instanceof Error) throw next
			return next as T
		},
	}
	return { client, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		async text() {
			return JSON.stringify(body)
		},
	} as unknown as Response
}

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
	for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
	process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR = PLAN.plusMonthlyGa
	process.env.RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR = PLAN.plusMonthlyFounding
	process.env.RAZORPAY_PLAN_PRO_ANNUAL_GA_INR = PLAN.proAnnualGa
	process.env.RAZORPAY_PLAN_PRO_ANNUAL_FOUNDING_INR = PLAN.proAnnualFounding
})

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key]
		else process.env[key] = savedEnv[key]
	}
	vi.unstubAllGlobals()
})

describe("razorpay createCheckout", () => {
	it("creates a subscription from the server-resolved plan id and returns the hosted short_url", async () => {
		const { client, calls } = recordingClient([
			{ id: "sub_1", short_url: "https://rzp.io/i/abc", status: "created" },
		])
		const gateway = createRazorpayGateway({ http: client })

		const session = await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "plus",
			cycle: "monthly",
			currency: "INR",
			isFounding: false,
		})

		expect(session).toEqual({ checkoutUrl: "https://rzp.io/i/abc", opaqueRef: "sub_1" })
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({ method: "POST", path: "/subscriptions" })
		expect(calls[0].body).toEqual({
			plan_id: PLAN.plusMonthlyGa,
			total_count: 1200,
			quantity: 1,
			customer_notify: true,
			notes: { workspace_id: "ws-1", tier: "plus", cycle: "monthly", is_founding: "false" },
		})
	})

	it("resolves the founding plan id strictly from the persisted cohort flag", async () => {
		const { client, calls } = recordingClient([
			{ id: "sub_f", short_url: "https://rzp.io/i/founding", status: "created" },
		])
		const gateway = createRazorpayGateway({ http: client })

		await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "pro",
			cycle: "annual",
			currency: "INR",
			isFounding: true,
		})

		const body = calls[0].body as { plan_id: string; total_count: number; notes: { is_founding: string } }
		expect(body.plan_id).toBe(PLAN.proAnnualFounding)
		expect(body.plan_id).not.toBe(PLAN.proAnnualGa)
		expect(body.total_count).toBe(100)
		expect(body.notes.is_founding).toBe("true")
	})

	it("rejects Team in INR before any provider call (Team is USD-only)", async () => {
		const { client, calls } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })

		await expect(
			gateway.createCheckout({
				workspaceId: "ws-1",
				tier: "team",
				cycle: "monthly",
				currency: "INR",
				isFounding: false,
			}),
		).rejects.toMatchObject({ name: "TierUnavailableError" })
		expect(calls).toHaveLength(0)
	})

	it("refuses a non-INR checkout on the INR rail", async () => {
		const { client, calls } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })

		await expect(
			gateway.createCheckout({
				workspaceId: "ws-1",
				tier: "plus",
				cycle: "monthly",
				currency: "USD",
				isFounding: false,
			}),
		).rejects.toBeInstanceOf(UnsupportedCurrencyError)
		expect(calls).toHaveLength(0)
	})

	it("fails closed when the plan env binding is missing", async () => {
		delete process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR
		const { client, calls } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })

		await expect(
			gateway.createCheckout({
				workspaceId: "ws-1",
				tier: "plus",
				cycle: "monthly",
				currency: "INR",
				isFounding: false,
			}),
		).rejects.toBeInstanceOf(PriceConfigError)
		expect(calls).toHaveLength(0)
	})
})

describe("razorpay cancel", () => {
	it("cancels at the end of the current billing cycle", async () => {
		const { client, calls } = recordingClient([{ id: "sub_1", status: "active" }])
		const gateway = createRazorpayGateway({ http: client })

		await gateway.cancelAtPeriodEnd("sub_1")

		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			method: "POST",
			path: "/subscriptions/sub_1/cancel",
			body: { cancel_at_cycle_end: true },
		})
	})
})

describe("razorpay portal seam", () => {
	it("returns the hosted card-update link without creating a portal session", async () => {
		const { client, calls } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })

		const session = await gateway.portalUrl("https://rzp.io/i/abc")

		expect(session).toEqual({ url: "https://rzp.io/i/abc", kind: "card_update" })
		expect(calls).toHaveLength(0)
	})

	it("rejects an empty hosted link rather than fabricating one", async () => {
		const { client } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })
		await expect(gateway.portalUrl("")).rejects.toBeInstanceOf(RazorpayConfigError)
	})

	it("fails closed on a non-https argument instead of fabricating a card-update link", async () => {
		const { client, calls } = recordingClient([])
		const gateway = createRazorpayGateway({ http: client })

		// BLOCKING-3: the portal route currently passes `gateway_customer_id`
		// (`cust_…`); the rail must refuse it rather than 200 with a broken redirect.
		await expect(gateway.portalUrl("cust_D00000000000006")).rejects.toBeInstanceOf(RazorpayConfigError)
		await expect(gateway.portalUrl("http://rzp.io/i/insecure")).rejects.toBeInstanceOf(RazorpayConfigError)
		await expect(gateway.portalUrl("rzp.io/i/relative")).rejects.toBeInstanceOf(RazorpayConfigError)
		expect(calls).toHaveLength(0)
	})
})

describe("razorpay scheduled plan change", () => {
	it("schedules a cycle-end change, preserving the cohort inferred from the current plan", async () => {
		const { client, calls } = recordingClient([
			{
				id: "sub_1",
				plan_id: PLAN.plusMonthlyFounding,
				status: "active",
				current_end: 1580841000,
				has_scheduled_changes: false,
			},
			{
				id: "sub_1",
				plan_id: PLAN.proAnnualFounding,
				status: "active",
				current_end: 1580841000,
				has_scheduled_changes: true,
				change_scheduled_at: 1580841000,
			},
		])
		const gateway = createRazorpayGateway({ http: client })

		const result = await gateway.schedulePlanChange({
			subscriptionRef: "sub_1",
			tier: "pro",
			cycle: "annual",
		})

		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /subscriptions/sub_1",
			"PATCH /subscriptions/sub_1",
		])
		expect(calls[1].body).toEqual({
			plan_id: PLAN.proAnnualFounding,
			schedule_change_at: "cycle_end",
			customer_notify: true,
		})
		expect(result).toEqual({
			subscriptionRef: "sub_1",
			tier: "pro",
			cycle: "annual",
			effectiveAt: new Date(1580841000 * 1000).toISOString(),
			scheduledChangeRef: "sub_1:1580841000",
		})
	})

	it("refuses to schedule a change when the current cohort cannot be resolved", async () => {
		const { client, calls } = recordingClient([
			{ id: "sub_1", plan_id: "plan_unmapped", status: "active", current_end: 1580841000 },
		])
		const gateway = createRazorpayGateway({ http: client })

		await expect(
			gateway.schedulePlanChange({ subscriptionRef: "sub_1", tier: "pro", cycle: "annual" }),
		).rejects.toBeInstanceOf(RazorpayConfigError)
		expect(calls.map((call) => call.method)).toEqual(["GET"])
	})

	it("refuses to infer a cohort when one plan id is bound to multiple env keys", async () => {
		// MEDIUM: a FOUNDING and a GA binding misconfigured to the same plan id must
		// fail closed rather than let first-match-wins infer GA for a founder.
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR = PLAN.plusMonthlyFounding
		const { client, calls } = recordingClient([
			{ id: "sub_1", plan_id: PLAN.plusMonthlyFounding, status: "active", current_end: 1580841000 },
		])
		const gateway = createRazorpayGateway({ http: client })

		await expect(
			gateway.schedulePlanChange({ subscriptionRef: "sub_1", tier: "pro", cycle: "annual" }),
		).rejects.toBeInstanceOf(RazorpayConfigError)
		expect(calls.map((call) => call.method)).toEqual(["GET"])
	})

	it("maps a pending scheduled change via the entity flag, then retrieves the update entity", async () => {
		const { client, calls } = recordingClient([
			// 1) entity flag pre-check: a change is pending
			{
				id: "sub_1",
				plan_id: PLAN.plusMonthlyFounding,
				has_scheduled_changes: true,
				change_scheduled_at: 1580841000,
				current_end: 1580841000,
			},
			// 2) the pending-update entity carries the scheduled plan
			{
				id: "sub_1",
				plan_id: PLAN.proAnnualFounding,
				has_scheduled_changes: true,
				change_scheduled_at: 1580841000,
				current_end: 1580841000,
			},
		])
		const gateway = createRazorpayGateway({ http: client })

		expect(await gateway.retrieveScheduledChange("sub_1")).toEqual({
			subscriptionRef: "sub_1",
			tier: "pro",
			cycle: "annual",
			effectiveAt: new Date(1580841000 * 1000).toISOString(),
			scheduledChangeRef: "sub_1:1580841000",
		})
		expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
			"GET /subscriptions/sub_1",
			"GET /subscriptions/sub_1/retrieve_scheduled_changes",
		])
	})

	it("returns null from the entity flag without calling retrieve when nothing is pending", async () => {
		// BLOCKING-2: `retrieve_scheduled_changes` returns 400 when nothing is pending,
		// so the rail must never reach it for a clean subscription.
		const { client, calls } = recordingClient([
			{ id: "sub_1", plan_id: PLAN.plusMonthlyFounding, has_scheduled_changes: false },
		])
		const gateway = createRazorpayGateway({ http: client })

		await expect(gateway.retrieveScheduledChange("sub_1")).resolves.toBeNull()
		expect(calls.map((call) => call.path)).toEqual(["/subscriptions/sub_1"])
	})

	it("cancels a scheduled change", async () => {
		const { client, calls } = recordingClient([{ id: "sub_1", has_scheduled_changes: false }])
		const gateway = createRazorpayGateway({ http: client })

		await gateway.cancelScheduledChange("sub_1")

		expect(calls[0]).toMatchObject({
			method: "POST",
			path: "/subscriptions/sub_1/cancel_scheduled_changes",
		})
	})
})

describe("razorpay read-back", () => {
	function stateFor(status: string, extra: Record<string, unknown> = {}) {
		const { client } = recordingClient([
			{ id: "sub_1", status, current_end: 1580841000, ...extra },
		])
		return createRazorpayGateway({ http: client }).getSubscriptionState("sub_1")
	}

	it("maps provider statuses to gateway states", async () => {
		expect((await stateFor("active")).status).toBe("active")
		expect((await stateFor("authenticated")).status).toBe("active")
		expect((await stateFor("pending")).status).toBe("past_due")
		expect((await stateFor("halted")).status).toBe("past_due")
		expect((await stateFor("cancelled")).status).toBe("canceled")
		expect((await stateFor("completed")).status).toBe("canceled")
		expect((await stateFor("expired")).status).toBe("canceled")
		expect((await stateFor("created")).status).toBe("incomplete")
	})

	it("maps the provider period end and surfaces a reported cycle-end cancellation", async () => {
		const active = await stateFor("active")
		expect(active.subscriptionRef).toBe("sub_1")
		expect(active.currentPeriodEnd).toBe(new Date(1580841000 * 1000).toISOString())

		const detaching = await stateFor("active", { cancel_at_cycle_end: true })
		expect(detaching.cancelAtPeriodEnd).toBe(true)
		expect(classifySubscription(detaching)).toBe("detaching")
	})

	it("fails closed on an unknown provider status rather than assuming inactive", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
		const state = await stateFor("brand_new_state")
		expect(state.status).toBe("active")
		expect(classifySubscription(state)).toBe("live")
		warn.mockRestore()
	})
})

describe("razorpay factory registration", () => {
	it("registers the razorpay rail through the self-registration seam", () => {
		const previous = process.env.LEKHAN_FAKE_PAYMENTS
		delete process.env.LEKHAN_FAKE_PAYMENTS
		try {
			expect(gatewayForRail("razorpay").rail).toBe("razorpay")
		} finally {
			if (previous === undefined) delete process.env.LEKHAN_FAKE_PAYMENTS
			else process.env.LEKHAN_FAKE_PAYMENTS = previous
		}
	})
})

describe("razorpay default HTTP client", () => {
	it("sends HTTP Basic auth to the Razorpay API and returns parsed JSON", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ id: "sub_1" }))
		vi.stubGlobal("fetch", fetchMock)
		const client = createRazorpayHttpClient({
			RAZORPAY_KEY_ID: "rzp_test_key",
			RAZORPAY_KEY_SECRET: "secret",
		} as unknown as NodeJS.ProcessEnv)

		const result = await client.request<{ id: string }>({
			method: "POST",
			path: "/subscriptions",
			body: { plan_id: "plan_x" },
		})

		expect(result).toEqual({ id: "sub_1" })
		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe(`${RAZORPAY_API_BASE}/subscriptions`)
		expect(init.method).toBe("POST")
		expect((init.headers as Record<string, string>).authorization).toBe(
			`Basic ${Buffer.from("rzp_test_key:secret").toString("base64")}`,
		)
		expect(JSON.parse(init.body as string)).toEqual({ plan_id: "plan_x" })
	})

	it("bounds every provider request with an abort signal so a hung call cannot park a handler", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ id: "sub_1" }))
		vi.stubGlobal("fetch", fetchMock)
		const client = createRazorpayHttpClient({
			RAZORPAY_KEY_ID: "k",
			RAZORPAY_KEY_SECRET: "s",
		} as unknown as NodeJS.ProcessEnv)

		await client.request({ method: "GET", path: "/subscriptions/sub_1" })

		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})

	it("fails closed before any network call when credentials are missing", async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		const client = createRazorpayHttpClient({} as NodeJS.ProcessEnv)

		await expect(client.request({ method: "GET", path: "/subscriptions/sub_1" })).rejects.toBeInstanceOf(
			RazorpayConfigError,
		)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("maps a provider error response to a RazorpayApiError with the provider code", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ error: { code: "BAD_REQUEST_ERROR", description: "bad request" } }, 400),
		)
		vi.stubGlobal("fetch", fetchMock)
		const client = createRazorpayHttpClient({
			RAZORPAY_KEY_ID: "k",
			RAZORPAY_KEY_SECRET: "s",
		} as unknown as NodeJS.ProcessEnv)

		await expect(client.request({ method: "GET", path: "/subscriptions/nope" })).rejects.toMatchObject({
			status: 400,
			providerCode: "BAD_REQUEST_ERROR",
		})
	})
})

describe("razorpay rail exposure", () => {
	it("uses the razorpay rail id", () => {
		const gateway = createRazorpayGateway({ http: recordingClient([]).client })
		expect(gateway.rail).toBe<Rail>("razorpay")
	})
})
