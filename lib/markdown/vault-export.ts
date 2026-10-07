import type { JSONContent } from '@tiptap/core'
import { markdownEngine } from '@/lib/markdown/engine'
import { resolveTags, slugifyTitle } from '@/lib/markdown-export'
import { buildZipBytes } from '@/lib/zip-write'
import {
	DATABASE_VIEWS_OMISSION,
	type FidelityOmission,
	type FidelityReport,
} from '@/lib/fidelity-report'

/**
 * Whole-Workspace → Obsidian vault export (SIL-9 S4). Pure and client-side:
 * take the Page graph plus each Page's doc, return vault files and an honest
 * report. No `fetch`, no storage — "leaving is always possible regardless of
 * service status" (story 13).
 *
 * The markdown dialect is S3's engine profile (`serializeObsidianBody`):
 * frontmatter from Page properties/tags, callouts (`> [!type]`), `[[wikilinks]]`,
 * inline `#tags`, native tables/code.
 */

export interface VaultPage {
	id: string
	parentId: string | null
	title: string
	/** Page tags (`page_tags`), mirrored into frontmatter. */
	tags?: string[]
	/** Page properties; `title`/`tags` are reserved and never duplicated. */
	properties?: Record<string, unknown>
	/** Tiptap doc JSON. Absent for folder pages and unloaded bodies. */
	doc?: JSONContent
	/** Import folder-pages carry no note; they only contribute a directory. */
	isFolder?: boolean
}

export interface VaultExportFile {
	/** Vault-relative path with forward slashes. */
	path: string
	data: Uint8Array | string
}

export type FidelityExportReport = FidelityReport & { direction: 'export' }

export interface VaultExportResult {
	files: VaultExportFile[]
	report: FidelityExportReport
}

const ATTACHMENTS_DIR = 'attachments'

const IMAGE_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/avif': 'avif',
	'image/x-icon': 'ico',
}

const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|[^[\]]+?)?\]\]/g

/** Mirrors the importer's normalizeTitle so link resolution agrees across directions. */
function normalizeTitle(title: string): string {
	return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function slug(title: string): string {
	return slugifyTitle(title) || 'untitled'
}

function decodeBase64(b64: string): Uint8Array | null {
	try {
		const binary = atob(b64)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
		return bytes
	} catch {
		return null
	}
}

/** FNV-1a over bytes → short hex, for stable attachment filenames. */
function shortHash(bytes: Uint8Array): string {
	let h = 0x811c9dc5
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i]
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, '0')
}

interface ParsedDataUri {
	mime: string
	bytes: Uint8Array
}

function parseDataUri(src: string): ParsedDataUri | null {
	const match = /^data:([^;,]+);base64,(.*)$/.exec(src)
	if (!match) return null
	const bytes = decodeBase64(match[2])
	if (!bytes) return null
	return { mime: match[1].toLowerCase(), bytes }
}

/**
 * Walk a Page doc and bundle every base64 image: decode it, write it once
 * under `attachments/` (deduped by content hash), and rewrite the node's src
 * to the vault-relative path so the file resolves in Obsidian. Returns a
 * cloned doc — the caller's unchanged. Malformed data URIs are left in place
 * and reported as degraded.
 */
function bundleImages(
	doc: JSONContent,
	attachments: Map<string, VaultExportFile>,
	degraded: { count: number },
): JSONContent {
	const visit = (node: JSONContent): JSONContent => {
		const next: JSONContent = { ...node }
		if (next.content) next.content = next.content.map(visit)

		if (next.type === 'image') {
			const src = typeof next.attrs?.src === 'string' ? (next.attrs.src as string) : ''
			if (!src.startsWith('data:')) return next

			const parsed = parseDataUri(src)
			if (!parsed) {
				degraded.count += 1
				return next
			}
			const ext = IMAGE_EXT[parsed.mime]
			if (!ext) {
				// A non-image data URI cannot become a vault file we can name.
				degraded.count += 1
				return next
			}
			const alt = typeof next.attrs?.alt === 'string' ? (next.attrs.alt as string) : ''
			const base = slug(alt) === 'untitled' ? 'image' : slug(alt)
			const filename = `${base}-${shortHash(parsed.bytes)}.${ext}`
			const path = `${ATTACHMENTS_DIR}/${filename}`
			if (!attachments.has(path)) attachments.set(path, { path, data: parsed.bytes })
			next.attrs = { ...next.attrs, src: path }
		}
		return next
	}
	return visit(doc)
}

/** Ancestor-title slugs for a Page, shallow-first (folder tree mirroring parent_id). */
function directorySegments(page: VaultPage, byId: Map<string, VaultPage>): string[] {
	const segments: string[] = []
	const seen = new Set<string>([page.id])
	let current = page.parentId
	while (current && !seen.has(current)) {
		seen.add(current)
		const parent = byId.get(current)
		if (!parent) break
		segments.unshift(slug(parent.title))
		current = parent.parentId
	}
	return segments
}

/** Unique `.md` filename inside a directory, appending `-2`, `-3`, … on collision. */
function uniqueBasename(used: Map<string, number>, dir: string, base: string, usedPaths: Set<string>): string {
	let candidate = base
	let n = used.get(`${dir}/${base}`) ?? 0
	while (usedPaths.has(`${dir}/${candidate}.md`)) {
		n += 1
		candidate = `${base}-${n + 1}`
	}
	used.set(`${dir}/${base}`, n)
	usedPaths.add(`${dir}/${candidate}.md`)
	return candidate
}

function collectLinkTargets(markdown: string, into: Set<string>): void {
	WIKILINK_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = WIKILINK_RE.exec(markdown)) !== null) {
		const target = match[1].trim()
		if (target) into.add(normalizeTitle(target))
	}
}

/**
 * Build the vault files (no zip). Deterministic for a given input order.
 */
export function buildVaultFiles(pages: VaultPage[]): VaultExportResult {
	const byId = new Map(pages.map((p) => [p.id, p]))
	const knownTitles = new Set(pages.map((p) => normalizeTitle(p.title)))

	const files: VaultExportFile[] = []
	const attachments = new Map<string, VaultExportFile>()
	const usedPaths = new Set<string>()
	const usedBasenames = new Map<string, number>()

	const linkTargets = new Set<string>()
	const degraded = { count: 0 }
	let noteCount = 0
	let folderCount = 0
	let databasePages = 0

	for (const page of pages) {
		if (page.isFolder) {
			folderCount += 1
			continue
		}

		const dirSegments = directorySegments(page, byId)
		const dir = dirSegments.join('/')
		const basename = uniqueBasename(usedBasenames, dir, slug(page.title), usedPaths)
		const path = [...dirSegments, `${basename}.md`].join('/')

		const rawDoc: JSONContent = page.doc ?? { type: 'doc', content: [] }
		const doc = bundleImages(rawDoc, attachments, degraded)

		const body = markdownEngine.serializeObsidianBody(doc)
		collectLinkTargets(body, linkTargets)

		const properties = page.properties ?? {}
		if (properties.database) databasePages += 1

		const tags = resolveTags(page.tags ?? [], properties)
		const file = markdownEngine.assembleMarkdownFile(
			{ title: page.title, properties, ...(tags.length > 0 ? { tags } : {}) },
			body,
		)
		files.push({ path, data: file })
		noteCount += 1
	}

	for (const attachment of attachments.values()) files.push(attachment)

	let linksResolved = 0
	let linksUnresolved = 0
	for (const target of linkTargets) {
		if (knownTitles.has(target)) linksResolved += 1
		else linksUnresolved += 1
	}

	const omissions: FidelityOmission[] = []
	if (databasePages > 0) omissions.push({ ...DATABASE_VIEWS_OMISSION, count: databasePages })

	const report: FidelityExportReport = {
		direction: 'export',
		pages: noteCount,
		folderPages: folderCount,
		linksResolved,
		linksUnresolved,
		degradedBlocks: degraded.count,
		omissions,
		warnings: [],
	}

	return { files, report }
}

/** Build the vault and zip it in one call. Pure: files in, bytes + report out. */
export function buildVaultZip(pages: VaultPage[]): { zip: Uint8Array; report: FidelityExportReport } {
	const { files, report } = buildVaultFiles(pages)
	return { zip: buildZipBytes(files), report }
}
