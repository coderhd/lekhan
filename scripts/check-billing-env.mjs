#!/usr/bin/env node
/**
 * Billing env presence check (#29 provisioning, spec §9).
 *
 * Prints whether each required billing env key is PRESENT — key names and
 * presence only, never values — across process.env plus dotenv-style files
 * (.env.local, .env, and any extra files given via --file). Exits 1 while any
 * required key is missing so it can gate the T14 QA pass.
 *
 * Usage:
 *   node scripts/check-billing-env.mjs [--file <path>]... [--json] [--require-https]
 *
 * The pulled-deployment check (`vercel env pull …` + `--file`) is documented in
 * docs/ops/provisioning/29-provider-test-credentials.md. Values read from files
 * are used for presence/https checks only and are never echoed or written.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")

/** The 27 billing keys (#29 provisioning) + the app origin binding. */
const REQUIRED_KEYS = [
	"STRIPE_SECRET_KEY",
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PLUS_MONTHLY_GA_USD",
	"STRIPE_PRICE_PLUS_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_PLUS_ANNUAL_GA_USD",
	"STRIPE_PRICE_PRO_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PRO_MONTHLY_GA_USD",
	"STRIPE_PRICE_PRO_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_PRO_ANNUAL_GA_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_GA_USD",
	"STRIPE_PRICE_TEAM_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_TEAM_ANNUAL_GA_USD",
	"RAZORPAY_KEY_ID",
	"RAZORPAY_KEY_SECRET",
	"RAZORPAY_WEBHOOK_SECRET",
	"RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR",
	"RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR",
	"RAZORPAY_PLAN_PLUS_ANNUAL_FOUNDING_INR",
	"RAZORPAY_PLAN_PLUS_ANNUAL_GA_INR",
	"RAZORPAY_PLAN_PRO_MONTHLY_FOUNDING_INR",
	"RAZORPAY_PLAN_PRO_MONTHLY_GA_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_FOUNDING_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_GA_INR",
	"CRON_SECRET",
	"BILLING_TRANSFER_TOKEN_SECRET",
]
const APP_URL_KEY = "NEXT_PUBLIC_APP_URL"
const CHECKED_KEYS = [...REQUIRED_KEYS, APP_URL_KEY]

function parseArgs(argv) {
	const opts = { files: [], json: false, requireHttps: false }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--file" && argv[i + 1]) {
			opts.files.push(argv[++i])
		} else if (argv[i] === "--json") {
			opts.json = true
		} else if (argv[i] === "--require-https") {
			opts.requireHttps = true
		} else {
			console.error(`Unknown argument: ${argv[i]} (usage: [--file <path>]... [--json] [--require-https])`)
			process.exit(2)
		}
	}
	return opts
}

/**
 * Parse a dotenv-style file into KEY → value. Only `keyName`/`firstValue` below
 * ever look at a value, and neither prints or persists one.
 */
function parseEnvFile(filePath) {
	let raw
	try {
		raw = readFileSync(filePath, "utf8")
	} catch {
		return null // missing file — reported as an absent source, not fatal
	}
	const entries = new Map()
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (trimmed === "" || trimmed.startsWith("#")) continue
		const withoutExport = trimmed.replace(/^export\s+/, "")
		const eq = withoutExport.indexOf("=")
		if (eq <= 0) continue
		const name = withoutExport.slice(0, eq).trim()
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || entries.has(name)) continue
		let value = withoutExport.slice(eq + 1).trim()
		if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
			value = value.slice(1, -1)
		}
		entries.set(name, value)
	}
	return entries
}

/** Precedence: process.env, then .env.local, then .env, then --file order. */
function buildSources(opts) {
	const sources = []
	for (const rel of [".env.local", ".env"]) {
		const parsed = parseEnvFile(resolve(REPO_ROOT, rel))
		if (parsed !== null) sources.push({ label: rel, entries: parsed })
	}
	for (const path of opts.files) {
		const parsed = parseEnvFile(resolve(path))
		if (parsed !== null) sources.push({ label: path, entries: parsed })
	}
	sources.push({ label: "process env", entries: new Map(Object.entries(process.env)) })
	return sources
}

/** First value seen for a key across sources, or undefined. Never printed. */
function firstValue(sources, key) {
	for (const { entries } of sources) {
		const value = entries.get(key)
		if (typeof value === "string" && value.trim() !== "") return value.trim()
	}
	return undefined
}

function main() {
	const opts = parseArgs(process.argv.slice(2))
	const sources = buildSources(opts)

	const missing = []
	const present = []
	for (const key of CHECKED_KEYS) {
		const where = sources.filter(({ entries }) => entries.has(key)).map(({ label }) => label)
		if (where.length === 0) missing.push(key)
		else present.push({ key, where })
	}

	const appUrlValue = firstValue(sources, APP_URL_KEY)
	const appUrlPresent = appUrlValue !== undefined
	const appUrlHttps = appUrlPresent ? appUrlValue.startsWith("https://") : false
	const ok = missing.length === 0 && (!opts.requireHttps || appUrlHttps)

	if (opts.json) {
		console.log(
			JSON.stringify(
				{
					ok,
					presentCount: present.length,
					requiredCount: REQUIRED_KEYS.length,
					missing,
					appUrl: { present: appUrlPresent, https: appUrlHttps },
				},
				null,
				2
			)
		)
	} else {
		console.log("Billing env presence check (names only — values are never printed)\n")
		const width = Math.max(...CHECKED_KEYS.map((k) => k.length))
		for (const { key, where } of present) {
			console.log(`  ✓ ${key.padEnd(width)}  ${where.join(", ")}`)
		}
		for (const key of missing) {
			console.log(`  ✗ ${key.padEnd(width)}  MISSING`)
		}
		const appNote = appUrlPresent ? ` (https: ${appUrlHttps ? "yes" : "no"})` : ""
		console.log(
			`\n  ${present.length}/${CHECKED_KEYS.length} checked (${REQUIRED_KEYS.length} required + ${APP_URL_KEY})${appNote}`
		)
		if (appUrlPresent && !appUrlHttps) {
			console.log(`  ! ${APP_URL_KEY} is not an https:// origin — provider webhooks need one (pass --require-https to fail on this)`)
		}
		console.log(missing.length === 0 ? "\n  OK — all billing keys present." : `\n  MISSING ${missing.length} key(s).`)
	}

	process.exit(ok ? 0 : 1)
}

main()
