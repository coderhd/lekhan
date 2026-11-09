#!/usr/bin/env node
/**
 * Renders the Brevo welcome templates at 320px and 600px for the previews in
 * docs/marketing/brevo/templates/README.md (SIL-224).
 *
 * Previews are rendered from the real template files with sample values
 * substituted for the merge tags, so the screenshots show what a recipient
 * sees — not a hand-written mock. Nothing is sent or uploaded.
 *
 * Usage:
 *   node scripts/render-brevo-previews.mjs
 *
 * Requires a local Chrome (or Playwright's bundled Chromium).
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "@playwright/test"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")
const TEMPLATES = join(REPO_ROOT, "docs/marketing/brevo/templates")
const PREVIEWS = join(TEMPLATES, "previews")
const WIDTHS = [320, 600]
const DPR = 2

/** Sample values so previews show realistic content instead of raw tags. */
const SAMPLE_TAGS = {
	"{{contact.FIRSTNAME}}": "Harsh",
	"{{contact.LASTNAME}}": "Dave",
	"{{contact.INVITE_URL}}": "https://lekhan.online/invite/0f6c2a1b9e4d",
	"{{unsubscribe}}": "https://lekhan.online/unsubscribe?token=sample",
	"{{senderAddress}}": "Lekhan · [postal address configured in Brevo]",
}

/** The wordmark is the only remote asset; the screenshot swaps in the repo copy so it renders offline. */
const LOCAL_LOGO = pathToFileURL(join(REPO_ROOT, "public/logo.png")).href
const LOGO_URL = "https://lekhan.online/logo.png"

function renderTemplate (source) {
	let html = source
	for (const [tag, value] of Object.entries(SAMPLE_TAGS)) html = html.replaceAll(tag, value)
	return html
}

async function launch () {
	try {
		return await chromium.launch({ channel: "chrome" })
	} catch {
		return chromium.launch()
	}
}

/** PNG pixel dimensions from the IHDR chunk. */
function pngSize (path) {
	const buffer = readFileSync(path)
	if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error(`${path} is not a PNG`)
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function main () {
	mkdirSync(PREVIEWS, { recursive: true })
	const files = readdirSync(TEMPLATES).filter((name) => name.endsWith(".html")).sort()
	if (files.length === 0) throw new Error(`No templates found in ${TEMPLATES}`)

	const browser = await launch()
	const written = []
	// Rendered copies live in a temp dir so file:// subresources (the local
	// wordmark) load; only the previews are committed.
	const tempDir = mkdtempSync(join(tmpdir(), "brevo-previews-"))

	try {
		for (const file of files) {
			const source = readFileSync(join(TEMPLATES, file), "utf8")
			const html = renderTemplate(source)
			// Saved HTML is committed alongside the screenshots: tag placeholders
			// are filled with sample values, the wordmark stays on its real URL.
			// It opens in a browser without Brevo.
			writeFileSync(join(PREVIEWS, file), html)
			const screenshotSource = join(tempDir, file)
			writeFileSync(screenshotSource, html.replaceAll(LOGO_URL, LOCAL_LOGO))

			for (const width of WIDTHS) {
				// A fresh page per capture: a reused page can produce a clipped or
				// tiled full-page screenshot on a cold start.
				const page = await browser.newPage({ deviceScaleFactor: DPR })
				try {
					await page.setViewportSize({ width, height: 900 })
					await page.goto(pathToFileURL(screenshotSource).href, { waitUntil: "load" })
					// eslint-disable-next-line no-undef -- runs in the browser page
					await page.evaluate(() => document.fonts.ready)
					// Layout guard: a wide fixed element would silently break 320px.
					// eslint-disable-next-line no-undef -- runs in the browser page
					const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
					if (overflow > 0) throw new Error(`${file} overflows horizontally at ${width}px by ${overflow}px`)

					const out = join(PREVIEWS, `${file.replace(/\.html$/, "")}-${width}.png`)
					await page.screenshot({ path: out, fullPage: true })

					// Capture guard: full-page screenshots have silently come back
					// clipped. Prove the PNG covers the whole document.
					// eslint-disable-next-line no-undef -- runs in the browser page
					const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
					const png = pngSize(out)
					const expectedHeight = Math.round(scrollHeight * DPR)
					if (png.width !== width * DPR || Math.abs(png.height - expectedHeight) > 2) {
						throw new Error(
							`${file} at ${width}px captured ${png.width}x${png.height}, expected ${width * DPR}x${expectedHeight}`
						)
					}
					written.push(out)
				} finally {
					await page.close()
				}
			}
		}
	} finally {
		await browser.close()
		rmSync(tempDir, { recursive: true, force: true })
	}

	for (const out of written) console.log(`wrote ${out.replace(`${REPO_ROOT}/`, "")}`)
	console.log(`\n${written.length} previews written. Review them, then commit.`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
