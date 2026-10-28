/**
 * T12 / D3 — server-derived default billing currency for the pricing UI.
 *
 * The explicit picker is the source of truth (US-2 AC1 escape hatch); this only
 * seeds it from the edge geo header on Vercel. Unknown/absent header (local dev,
 * non-Vercel) defaults to USD, never guesses India from the browser.
 */

import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest): Promise<NextResponse> {
	const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase() || null
	return NextResponse.json({
		currency: country === "IN" ? "INR" : "USD",
		country,
	})
}
