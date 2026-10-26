import JSZip from 'jszip'
import { markdownEngine, uint8ArrayToBase64 } from '@/lib/markdown/engine'
import { fitLiveSchema } from '@/lib/import-hydration'
import { canonicalJson, stableHash } from '@/lib/stable-content'
import type { ImportDegradation, ImportIR, ImportPage, ImportReport } from '@/services/import-ir'
import {
	MAX_IMPORT_FILE_BYTES,
	MAX_IMPORT_IMAGE_COUNT,
	MAX_IMPORT_PAGES,
	MAX_IMPORT_TOTAL_BYTES,
} from '@/services/import-limits'
import type { VaultEntry } from '@/services/obsidian-import'

/**
 * Notion **Markdown & CSV** export importer (SIL-58 / #78 S2).
 *
 * Parses the zip entirely in the browser — no Notion API, no OAuth, no rate
 * limits — and normalizes it into the shared `ImportIR`, so the existing
 * `/api/import` writer (batching, folder chains, encrypted snapshots, graph
 * indexing, #87 retry) is reused unchanged.
 *
 * Notion's export quirks this module owns:
 *  - every file/folder name ends in a 32-hex id;
 *  - links are UUID-bearing relative paths (punctuation may differ from the
 *    on-disk name) or `https://www.notion.so/Title-<id>` URLs;
 *  - databases are one CSV per exported view, plus a Markdown page per row;
 *  - images live in UUID-suffixed attachment folders;
 *  - callouts are HTML tables, and synced blocks/comments/formulas/rollups/
 *    attachments are flattened or absent, so the report must name them.
 */

export interface NotionExportContent {
	files: VaultEntry[]
	directories: string[]
	/** Number of zips selected (Notion splits large exports into parts). */
	parts: number
	/** Pages seen again in a later part (same Notion id) and skipped. */
	duplicatePagesSkipped: number
}

export interface NotionImportReport extends ImportReport {
	source: 'notion'
	databaseViewsDeferred: number
	databaseRows: number
	syncedBlocksFlattened: number
	commentsOmitted: true
	formulasRollupsFlattened: true
	attachmentsDropped: number
	exportParts: number
	duplicatePagesSkipped: number
}

export interface NotionImportResult {
	ir: ImportIR & { source: 'notion' }
	report: NotionImportReport
}

export interface NotionImportOptions {
	workspaceId: string
	/** Titles already in the workspace; a link to one of these counts as resolved. */
	existingPageTitles: string[]
}

const MARKDOWN_EXT = new Set(['.md', '.markdown'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'])

const IMAGE_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	avif: 'image/avif',
	ico: 'image/x-icon',
}

/** Relative file targets that are neither pages nor images: they are dropped. */
const ATTACHMENT_EXT = new Set([
	'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'key', 'pages', 'numbers',
	'zip', 'rar', '7z', 'gz', 'tar', 'txt', 'rtf', 'epub', 'odt', 'ods', 'odp',
	'mp3', 'wav', 'm4a', 'ogg', 'mp4', 'mov', 'webm', 'avi', 'mkv',
	'sketch', 'fig', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'js', 'ts', 'css',
])

const UUID_ANY_RE = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const TRAILING_ID_RE = /(?:[\s_-]+)((?:[0-9a-f]{32})|(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/i
/** Same, but preserves a file extension that follows the id. */
const TRAILING_ID_WITH_EXT_RE = /(?:[\s_-]+)((?:[0-9a-f]{32})|(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))(\.[^.]+)?$/i

function normalizePath (path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/\/+/g, '/')
}

function basename (path: string): string {
	return path.split('/').pop() ?? path
}

function dirname (path: string): string {
	const idx = path.lastIndexOf('/')
	return idx === -1 ? '' : path.slice(0, idx)
}

function extOf (path: string): string {
	const name = basename(path).toLowerCase()
	const idx = name.lastIndexOf('.')
	return idx === -1 ? '' : name.slice(idx)
}

function stemOf (path: string): string {
	const name = basename(path)
	const idx = name.lastIndexOf('.')
	return idx === -1 ? name : name.slice(0, idx)
}

function isMarkdown (path: string): boolean {
	return MARKDOWN_EXT.has(extOf(path))
}

function isCsv (path: string): boolean {
	return extOf(path) === '.csv'
}

function isImage (path: string): boolean {
	return IMAGE_EXT.has(extOf(path).slice(1))
}

/** `__MACOSX`, Finder metadata, and other archive junk are never pages. */
function isJunkPath (path: string): boolean {
	const segments = path.split('/')
	if (segments[0] === '__MACOSX') return true
	const name = basename(path)
	return name === '.DS_Store' || name.startsWith('._') || name.startsWith('.')
}

function safeDecode (value: string): string {
	const once = (() => {
		try {
			return decodeURIComponent(value)
		} catch {
			return value
		}
	})()
	// Notion occasionally double-encodes spaces in attachment paths.
	if (/%[0-9a-f]{2}/i.test(once)) {
		try {
			return decodeURIComponent(once)
		} catch {
			return once
		}
	}
	return once
}

/** Normalize a Notion id to 32 lowercase hex (dashes removed). */
export function normalizeNotionId (value: string): string | null {
	const match = value.match(UUID_ANY_RE)
	return match ? match[0].replace(/-/g, '').toLowerCase() : null
}

/** Strip the trailing ` <32hex>` Notion appends to file and folder names. */
export function stripNotionId (name: string): string {
	return name.replace(TRAILING_ID_WITH_EXT_RE, (_match, _id: string, ext: string | undefined) => ext ?? '').trim()
}

/**
 * Clean one archive path segment: Notion's trailing id is removed, and the
 * known export wrappers are dropped. A `/` can never survive inside a segment.
 */
function cleanSegment (segment: string): string {
	return stripNotionId(segment).replace(/\//g, '-').trim()
}

const EXPORT_WRAPPERS = new Set(['private & shared', 'private', 'shared', 'export'])

function isWrapperSegment (segment: string): boolean {
	const lower = segment.toLowerCase()
	return EXPORT_WRAPPERS.has(lower) || /^export[-_ ]/i.test(segment)
}

/** Clean an archive-relative path (file or folder) for display/hierarchy. */
export function cleanNotionPath (path: string): string {
	const normalized = normalizePath(path)
	if (!normalized) return ''
	const segments = normalized.split('/')
	let start = 0
	while (start < segments.length - 1 && isWrapperSegment(segments[start])) start += 1
	return segments
		.slice(start)
		.map(cleanSegment)
		.filter(Boolean)
		.join('/')
}

function csvDatabaseTitle (csvPath: string): string {
	const stem = stemOf(csvPath).replace(/_all$/i, '').replace(/\s+_all$/i, '')
	return stripNotionId(stem) || 'Database'
}

function normalizeTitle (title: string): string {
	return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function ancestorDirs (path: string): string[] {
	const segments = path.split('/')
	const dirs: string[] = []
	for (let i = 1; i < segments.length; i++) dirs.push(segments.slice(0, i).join('/'))
	return dirs
}

// ---------------------------------------------------------------------------
// Reader — bounded, client-side, multi-part aware
// ---------------------------------------------------------------------------

interface RawArchiveEntry {
	path: string
	data: Uint8Array
}

interface ReadBudget {
	totalBytes: number
	images: number
}

async function readOneZip (
	zipFile: File,
	budget: ReadBudget
): Promise<{ entries: RawArchiveEntry[]; directories: string[] }> {
	const zip = await JSZip.loadAsync(zipFile)
	const entries: RawArchiveEntry[] = []
	const directories = new Set<string>()
	const rawKeys = Object.keys(zip.files)

	for (const rawPath of rawKeys) {
		const path = normalizePath(rawPath)
		if (!path || isJunkPath(path)) continue
		const entry = zip.files[rawPath]
		if (entry.dir) continue
		if (!isMarkdown(path) && !isCsv(path) && !isImage(path)) continue

		const isImg = isImage(path)
		// Validate the reported uncompressed size before decompressing: a zip
		// bomb must not be able to allocate unbounded memory. Fail closed if the
		// size is unavailable rather than decompressing first and checking after.
		const maybeData: unknown = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
		const reportedSize =
			maybeData && typeof (maybeData as { uncompressedSize?: unknown }).uncompressedSize === 'number'
				? (maybeData as { uncompressedSize: number }).uncompressedSize
				: undefined
		if (reportedSize === undefined) {
			throw new Error(`Could not verify the uncompressed size of "${path}"; refusing to decompress it.`)
		}
		if (reportedSize > MAX_IMPORT_FILE_BYTES) {
			throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
		}
		if (budget.totalBytes + reportedSize > MAX_IMPORT_TOTAL_BYTES) {
			throw new Error(`Export exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
		}
		if (isImg && budget.images + 1 > MAX_IMPORT_IMAGE_COUNT) {
			throw new Error(
				`Export exceeds maximum number of image attachments (${MAX_IMPORT_IMAGE_COUNT}). Split the export and import it in parts.`
			)
		}

		const data = await entry.async('uint8array')
		if (data.length > MAX_IMPORT_FILE_BYTES) {
			throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
		}
		if (budget.totalBytes + data.length > MAX_IMPORT_TOTAL_BYTES) {
			throw new Error(`Export exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
		}
		budget.totalBytes += data.length
		if (isImg) budget.images += 1
		entries.push({ path, data })
		for (const dir of ancestorDirs(path)) directories.add(dir)
	}

	return { entries, directories: [...directories] }
}

/**
 * Read one or many Notion export zips. Multi-part exports are merged by page
 * id: Notion can include a nested page in more than one part, and importing it
 * twice would duplicate the page. The duplicate is skipped and reported.
 */
export async function readNotionZips (zipFiles: File[]): Promise<NotionExportContent> {
	if (zipFiles.length === 0) {
		throw new Error('Select a Notion export .zip first.')
	}

	const files: RawArchiveEntry[] = []
	const directories = new Set<string>()
	const seenPaths = new Set<string>()
	const seenPageIds = new Set<string>()
	// One budget across every selected part: per-part budgets would let a
	// multi-part selection exceed the documented envelope (N × limits).
	const budget: ReadBudget = { totalBytes: 0, images: 0 }
	let duplicatePagesSkipped = 0

	for (const zipFile of zipFiles) {
		const part = await readOneZip(zipFile, budget)
		for (const dir of part.directories) directories.add(dir)
		for (const entry of part.entries) {
			const key = entry.path.toLowerCase()
			if (seenPaths.has(key)) continue
			if (isMarkdown(entry.path)) {
				const pageId = normalizeNotionId(stemOf(entry.path))
				if (pageId) {
					if (seenPageIds.has(pageId)) {
						duplicatePagesSkipped += 1
						continue
					}
					seenPageIds.add(pageId)
				}
			}
			seenPaths.add(key)
			files.push(entry)
		}
	}

	return {
		files: files.map(file => ({ path: file.path, data: file.data })),
		directories: [...directories],
		parts: zipFiles.length,
		duplicatePagesSkipped,
	}
}

/** Convenience single-zip reader (the common case). */
export function readNotionZip (zipFile: File): Promise<NotionExportContent> {
	return readNotionZips([zipFile])
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

/** Parse CSV text, including quoted commas, escaped quotes, CRLF and BOM. */
export function parseCsv (text: string): string[][] {
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
	const rows: string[][] = []
	let row: string[] = []
	let cell = ''
	let quoted = false

	for (let i = 0; i < input.length; i++) {
		const char = input[i]
		if (quoted) {
			if (char === '"') {
				if (input[i + 1] === '"') {
					cell += '"'
					i += 1
				} else {
					quoted = false
				}
			} else {
				cell += char
			}
			continue
		}
		if (char === '"') {
			// RFC 4180 only opens a quoted field at the start of a cell. A stray
			// quote mid-cell is literal data, not an unterminated field that would
			// swallow the rest of the file.
			if (cell === '') quoted = true
			else cell += '"'
		} else if (char === ',') {
			row.push(cell)
			cell = ''
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[i + 1] === '\n') i += 1
			row.push(cell)
			rows.push(row)
			row = []
			cell = ''
		} else {
			cell += char
		}
	}
	if (cell.length > 0 || row.length > 0) {
		row.push(cell)
		rows.push(row)
	}
	return rows
}

interface CsvDatabase {
	path: string
	title: string
	/** Cleaned folder that row pages live in. */
	folder: string
	/** Column whose cell becomes each row Page's title (Notion exports it first). */
	titleColumn: string
	records: Array<{ title: string; properties: Record<string, unknown> }>
}

function isWrapperOnlyDir (rawDir: string): boolean {
	const segments = normalizePath(rawDir).split('/').filter(Boolean)
	return segments.length > 0 && segments.every(isWrapperSegment)
}

function parseDatabaseCsv (path: string, data: Uint8Array): CsvDatabase {
	const text = new TextDecoder().decode(data)
	const rows = parseCsv(text)
	const headerRow = rows.shift() ?? []
	const headers: string[] = []
	const seen = new Map<string, number>()
	for (const raw of headerRow) {
		const base = raw.trim() || 'Column'
		const count = (seen.get(base) ?? 0) + 1
		seen.set(base, count)
		headers.push(count === 1 ? base : `${base} (${count})`)
	}
	const titleColumn = headers[0] || 'Name'
	const rawDir = dirname(path)
	// A CSV can be a sibling of its database folder (`Tasks <id>.csv` next to
	// `Tasks <id>/`), or sit at the export wrapper root. Both mean the row pages
	// live in a folder named after the database, not in the CSV's own directory.
	const folder = cleanNotionPath(rawDir) && !isWrapperOnlyDir(rawDir)
		? cleanNotionPath(rawDir)
		: csvDatabaseTitle(path)

	const records: Array<{ title: string; properties: Record<string, unknown> }> = []
	for (const row of rows) {
		if (row.every(cell => cell.trim() === '')) continue
		const properties: Record<string, unknown> = {}
		headers.forEach((header, index) => {
			properties[header] = row[index] ?? ''
		})
		const title = (row[0] ?? '').trim() || 'Untitled'
		records.push({ title, properties })
	}

	return { path, title: csvDatabaseTitle(path), folder, titleColumn, records }
}

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

interface RawNotionPage {
	/** Raw archive path (used for relative link/image resolution). */
	path: string
	/** Cleaned path (used for hierarchy and display). */
	cleanPath: string
	title: string
	folderPath: string | null
	blockId: string | null
	raw: string
	/** CSV columns (database rows) or frontmatter properties. */
	properties: Record<string, unknown>
	/** Populated when this page is also a database row. */
	database?: { title: string; csvPath: string; titleColumn: string }
	/** CSV-row pages have no Markdown file of their own. */
	synthetic?: boolean
}

interface LinkStats {
	/** normalized target → whether at least one occurrence resolved. */
	targets: Map<string, boolean>
}

function recordTarget (stats: LinkStats, title: string, resolved: boolean): void {
	const key = normalizeTitle(title)
	if (!key) return
	const previous = stats.targets.get(key)
	stats.targets.set(key, (previous ?? false) || resolved)
}

// ---------------------------------------------------------------------------
// Link / image resolution
// ---------------------------------------------------------------------------

interface MediaIndex {
	byPath: Map<string, VaultEntry>
	byBasename: Map<string, VaultEntry[]>
}

function normalizeRelativePath (path: string): string {
	const parts: string[] = []
	for (const segment of normalizePath(path).split('/')) {
		if (!segment || segment === '.') continue
		if (segment === '..') {
			parts.pop()
			continue
		}
		parts.push(segment)
	}
	return parts.join('/')
}

function resolveRelative (target: string, notePath: string, index: MediaIndex): VaultEntry | null {
	const decoded = normalizeRelativePath(safeDecode(target))
	if (!decoded) return null
	const noteFolder = dirname(notePath)
	const candidates = [
		noteFolder ? normalizeRelativePath(`${noteFolder}/${decoded}`) : decoded,
		decoded,
	]
	for (const candidate of candidates) {
		const exact = index.byPath.get(candidate.toLowerCase())
		if (exact) return exact
	}
	const base = basename(decoded).toLowerCase()
	const byName = index.byBasename.get(base)
	return byName && byName.length === 1 ? byName[0] : null
}

/** Notion callouts are exported as a one-row, two-cell HTML table. */
const CALLOUT_TABLE_RE = /<table>\s*<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>\s*<\/table>/gi

function stripHtml (value: string): string {
	return value
		// Keep links inside a callout as Markdown links before tags disappear.
		.replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_match, hrefA: string | undefined, hrefB: string | undefined, text: string) => {
			const href = hrefA ?? hrefB ?? ''
			const label = text.replace(/<[^>]+>/g, '').trim()
			return label ? `[${label}](${href})` : ''
		})
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.trim()
}

function calloutTypeFor (icon: string): string {
	if (/[💡🔎]/u.test(icon)) return 'tip'
	if (/[⚠❗🔺]/u.test(icon)) return 'warning'
	if (/[✅✔]/u.test(icon)) return 'success'
	if (/[ℹ❕]/u.test(icon)) return 'info'
	if (/[🔥❌]/u.test(icon)) return 'danger'
	return 'note'
}

function toObsidianCallout (icon: string, content: string): string {
	const type = calloutTypeFor(icon)
	const body = stripHtml(content)
	const lines = body.split('\n').map(line => `> ${line}`.trimEnd())
	return [`> [!${type}]`, ...lines].join('\n')
}

function unwrapCallouts (body: string): { body: string; converted: number } {
	let converted = 0
	const next = body.replace(CALLOUT_TABLE_RE, (whole, iconRaw: string, contentRaw: string) => {
		const icon = stripHtml(iconRaw)
		// A real callout has a short icon cell; a content table must pass through.
		if (icon.length > 8 || !stripHtml(contentRaw)) return whole
		converted += 1
		return toObsidianCallout(icon, contentRaw)
	})
	return { body: next, converted }
}

const SYNCED_BLOCK_RE = /<!--\s*(?:notion[-_ ]?)?synced[_-]?block[^>]*-->/gi

function stripSyncedMarkers (body: string): { body: string; count: number } {
	let count = 0
	const next = body.replace(SYNCED_BLOCK_RE, () => {
		count += 1
		return ''
	})
	return { body: next, count }
}

/** Remove a leading H1 that only repeats the page title. */
function stripDuplicateTitleHeading (body: string, title: string): string {
	const match = body.match(/^\s*#\s+([^\n]+?)\s*(?:\n|$)/)
	if (!match) return body
	if (normalizeTitle(match[1]) !== normalizeTitle(title)) return body
	return body.slice(match[0].length)
}

function isExternalTarget (target: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)
}

/**
 * Apply a body transform only outside fenced code blocks and inline code
 * spans. A page that documents Markdown (or a synced block containing code)
 * must not have its literal `[link](target)` / `![alt](image)` examples
 * rewritten, and must not inflate the "dropped attachment" count.
 */
function mapOutsideCode (body: string, transform: (segment: string) => string): string {
	const lines = body.split('\n')
	const out: string[] = []
	let inFence = false
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence
			out.push(line)
			continue
		}
		if (inFence) {
			out.push(line)
			continue
		}
		const parts = line.split(/(`+[^`]*`+)/g)
		out.push(parts.map((part, index) => (index % 2 === 1 ? part : transform(part))).join(''))
	}
	return out.join('\n')
}

function isNotionUrl (target: string): boolean {
	return /^https?:\/\/(?:www\.)?notion\.(?:so|site)\//i.test(target)
}

function titleFromNotionUrl (target: string): string | null {
	const withoutQuery = target.split(/[?#]/)[0]
	const last = withoutQuery.split('/').filter(Boolean).pop()
	if (!last) return null
	const withoutId = last.replace(/[-_][0-9a-f-]{32,36}$/i, '')
	const decoded = safeDecode(withoutId).replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
	return decoded || null
}

function cleanLinkTitle (target: string): string {
	const withoutQuery = safeDecode(target.split(/[?#]/)[0])
	const last = withoutQuery.split('/').filter(Boolean).pop() ?? withoutQuery
	const stem = last.replace(/\.(md|markdown|csv)$/i, '')
	return stripNotionId(stem) || 'Untitled'
}

function resolvePageTarget (
	target: string,
	pagesById: Map<string, RawNotionPage>,
	pagesByTitle: Map<string, RawNotionPage[]>,
	databasesByFolder: Map<string, CsvDatabase>,
	existingTitles: Set<string>
): string | null {
	const id = target.match(UUID_ANY_RE)?.[0]
	if (id) {
		const page = pagesById.get(id.replace(/-/g, '').toLowerCase())
		if (page) return page.title
	}
	const isDbLink = /\.csv(?:[?#]|$)/i.test(target)
	if (isDbLink) {
		const last = safeDecode(target.split(/[?#]/)[0].split('/').pop() ?? '')
		const id = last.match(UUID_ANY_RE)?.[0]?.replace(/-/g, '').toLowerCase()
		const stem = stripNotionId(last.replace(/\.csv$/i, '').replace(/_all$/i, ''))
		const db = [...databasesByFolder.values()].find(candidate => {
			if (id && normalizeNotionId(basename(candidate.path)) === id) return true
			return normalizeTitle(candidate.title) === normalizeTitle(stem)
		})
		if (db) return db.title
	}
	const title = isNotionUrl(target) ? titleFromNotionUrl(target) : cleanLinkTitle(target)
	if (!title) return null
	if (existingTitles.has(normalizeTitle(title))) return title
	if (pagesByTitle.has(normalizeTitle(title))) return title
	return null
}

// ---------------------------------------------------------------------------
// Body normalization
// ---------------------------------------------------------------------------

interface BodyContext {
	page: RawNotionPage
	media: MediaIndex
	pagesById: Map<string, RawNotionPage>
	pagesByTitle: Map<string, RawNotionPage[]>
	databasesByFolder: Map<string, CsvDatabase>
	existingTitles: Set<string>
	linkStats: LinkStats
	stats: {
		attachmentsDropped: number
		degradedBlocks: number
		calloutsConverted: number
		syncedBlocksFlattened: number
	}
}

function imageDataUrl (entry: VaultEntry, path: string): string {
	const ext = extOf(path).slice(1)
	const mime = IMAGE_MIME[ext] ?? 'application/octet-stream'
	return `data:${mime};base64,${uint8ArrayToBase64(entry.data)}`
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const HTML_IMAGE_RE = /<img\b([^>]*?)\/?>/gi

function replaceImages (body: string, ctx: BodyContext): string {
	return mapOutsideCode(body, (segment) => {
		const withMarkdown = segment.replace(MARKDOWN_IMAGE_RE, (whole, altRaw: string, target: string) => {
			if (isExternalTarget(target)) return whole
			const alt = altRaw || 'Image'
			const entry = resolveRelative(target, ctx.page.path, ctx.media)
			if (entry && isImage(entry.path)) return `![${alt}](${imageDataUrl(entry, entry.path)})`
			ctx.stats.attachmentsDropped += 1
			return alt
		})

		return withMarkdown.replace(HTML_IMAGE_RE, (whole, attrs: string) => {
			const src = attrs.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
			const altMatch = attrs.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
			const alt = altMatch?.[1] ?? altMatch?.[2] ?? 'Image'
			if (!src) return whole
			const target = src[1] ?? src[2] ?? ''
			if (isExternalTarget(target)) return whole
			const entry = resolveRelative(target, ctx.page.path, ctx.media)
			if (entry && isImage(entry.path)) return `![${alt}](${imageDataUrl(entry, entry.path)})`
			ctx.stats.attachmentsDropped += 1
			return alt
		})
	})
}

const MARKDOWN_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

/** `[[Title]]`-style links cannot encode `|` or `]]` inside the target. */
function toWikilink (title: string, text: string): string | null {
	if (/[|\]]/.test(title)) return null
	return normalizeTitle(title) === normalizeTitle(text) ? `[[${title}]]` : `[[${title}|${text}]]`
}

function replaceLinks (body: string, ctx: BodyContext): string {
	return mapOutsideCode(body, (segment) => segment.replace(MARKDOWN_LINK_RE, (whole, textRaw: string, target: string) => {
		if (target.startsWith('#')) {
			// Same-page block reference: the page is intact, the block anchor is
			// not representable. Keep the visible text and count the degradation.
			ctx.stats.degradedBlocks += 1
			return textRaw
		}
		// Never import executable schemes from a third-party archive.
		if (/^(?:javascript|vbscript|data|file):/i.test(target)) {
			ctx.stats.degradedBlocks += 1
			return textRaw
		}
		if (isExternalTarget(target) && !isNotionUrl(target)) return whole
		if (target.startsWith('mailto:')) return whole

		const resolved = resolvePageTarget(target, ctx.pagesById, ctx.pagesByTitle, ctx.databasesByFolder, ctx.existingTitles)
		if (resolved) {
			const link = toWikilink(resolved, textRaw)
			if (link) {
				recordTarget(ctx.linkStats, resolved, true)
				return link
			}
			// A resolved title we cannot encode must not become a dangling
			// `[[B|alias]]`; keep the text and name the degradation.
			ctx.stats.degradedBlocks += 1
			return textRaw
		}

		// Relative attachment (non-page, non-image): keep its label visible,
		// drop the dead target, and report it. CSV/database links are pages.
		const ext = extOf(target.split(/[?#]/)[0]).slice(1).toLowerCase()
		if (!isExternalTarget(target) && ATTACHMENT_EXT.has(ext)) {
			ctx.stats.attachmentsDropped += 1
			return textRaw
		}

		const fallback = isNotionUrl(target) ? titleFromNotionUrl(target) : cleanLinkTitle(target)
		if (!fallback) return whole
		const link = toWikilink(fallback, textRaw)
		if (!link) {
			ctx.stats.degradedBlocks += 1
			return textRaw
		}
		recordTarget(ctx.linkStats, fallback, false)
		return link
	}))
}

const BARE_NOTION_URL_RE = /(^|[\s(])(https?:\/\/(?:www\.)?notion\.(?:so|site)\/[^\s)]+)/gi

function replaceBareNotionUrls (body: string, ctx: BodyContext): string {
	return mapOutsideCode(body, (segment) => segment.replace(BARE_NOTION_URL_RE, (whole, prefix: string, url: string) => {
		const title = resolvePageTarget(url, ctx.pagesById, ctx.pagesByTitle, ctx.databasesByFolder, ctx.existingTitles)
		if (title) {
			const link = toWikilink(title, title)
			if (link) {
				recordTarget(ctx.linkStats, title, true)
				return `${prefix}${link}`
			}
			ctx.stats.degradedBlocks += 1
			return whole
		}
		const fallback = titleFromNotionUrl(url)
		if (!fallback) return whole
		const link = toWikilink(fallback, fallback)
		if (!link) {
			ctx.stats.degradedBlocks += 1
			return whole
		}
		recordTarget(ctx.linkStats, fallback, false)
		return `${prefix}${link}`
	}))
}

const UNSUPPORTED_HTML_RE = /<(table|iframe|video|audio|figure|details|summary|embed|object)\b/gi

function processBody (page: RawNotionPage, ctx: BodyContext): string {
	let body = stripDuplicateTitleHeading(page.raw, page.title)
	body = replaceImages(body, ctx)
	const callouts = unwrapCallouts(body)
	ctx.stats.calloutsConverted += callouts.converted
	body = callouts.body
	const synced = stripSyncedMarkers(body)
	ctx.stats.syncedBlocksFlattened += synced.count
	body = synced.body
	body = replaceLinks(body, ctx)
	body = replaceBareNotionUrls(body, ctx)

	// Anything block-level we could not map is named rather than silently
	// dropped by the Markdown parser. `data-callout` divs are ours, not Notion's.
	const leftovers = body.match(UNSUPPORTED_HTML_RE)
	if (leftovers) ctx.stats.degradedBlocks += leftovers.length

	return body
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

const EMPTY_PAGE_DOC = {
	type: 'doc',
	content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
}
const EMPTY_PAGE_CONTENT_HASH = stableHash(canonicalJson(EMPTY_PAGE_DOC))

function looksLikeNotionExport (content: NotionExportContent): boolean {
	return content.files.some(file => {
		if (isCsv(file.path)) {
			// A Notion database CSV is UUID-named (or the `_all` view export).
			return normalizeNotionId(file.path) !== null || /_all\.csv$/i.test(file.path)
		}
		if (!isMarkdown(file.path)) return false
		return TRAILING_ID_RE.test(stemOf(file.path))
	})
}

/**
 * Normalize a Notion Markdown & CSV export into the shared IR + an honest
 * report. Pure and synchronous; only reading the zips is async.
 */
export function importNotionExport (
	content: NotionExportContent,
	options: NotionImportOptions
): NotionImportResult {
	const { workspaceId, existingPageTitles } = options

	if (content.files.length === 0) {
		throw new Error(
			'No Notion pages or database rows found in that export. If you exported HTML, re-export with Export → Markdown & CSV and select that .zip.'
		)
	}
	if (!looksLikeNotionExport(content)) {
		throw new Error(
			'This doesn\'t look like a Notion export. Use Export → Markdown & CSV in Notion, then select the downloaded .zip (not an HTML export or an Obsidian vault).'
		)
	}

	// Media index is keyed by RAW archive paths: Notion's Markdown links point at
	// the UUID-suffixed folder names, before our display-name cleaning.
	const media: MediaIndex = { byPath: new Map(), byBasename: new Map() }
	for (const file of content.files) {
		if (!isImage(file.path)) continue
		media.byPath.set(file.path.toLowerCase(), file)
		const base = basename(file.path).toLowerCase()
		const list = media.byBasename.get(base) ?? []
		list.push(file)
		media.byBasename.set(base, list)
	}

	// --- Markdown pages -----------------------------------------------------
	const rawPages: RawNotionPage[] = []
	for (const file of content.files) {
		if (!isMarkdown(file.path)) continue
		const raw = new TextDecoder().decode(file.data)
		let body = raw
		let frontmatterTitle: string | undefined
		let frontmatterProperties: Record<string, unknown> = {}
		try {
			const parsed = markdownEngine.parseFrontmatter(raw)
			body = parsed.body
			frontmatterTitle = parsed.data.title
			frontmatterProperties = parsed.data.properties
		} catch {
			// Notion does not emit YAML frontmatter, but a malformed file must
			// still import: fall back to the raw body rather than losing the page.
		}
		const cleanPath = cleanNotionPath(file.path)
		const segments = cleanPath.split('/')
		const filenameTitle = stripNotionId(segments[segments.length - 1]?.replace(/\.(md|markdown)$/i, '') ?? '')
		const title = frontmatterTitle ?? filenameTitle
		rawPages.push({
			path: file.path,
			cleanPath,
			title: title || 'Untitled',
			folderPath: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
			blockId: normalizeNotionId(stemOf(file.path)),
			raw: body,
			properties: frontmatterProperties,
		})
	}

	// --- Databases ----------------------------------------------------------
	const csvFiles = content.files.filter(file => isCsv(file.path))
	const databasesByFolder = new Map<string, CsvDatabase>()
	const csvByFolder = new Map<string, VaultEntry[]>()
	for (const file of csvFiles) {
		const folder = cleanNotionPath(dirname(file.path))
		const list = csvByFolder.get(folder) ?? []
		list.push(file)
		csvByFolder.set(folder, list)
	}
	for (const [folder, filesInFolder] of csvByFolder.entries()) {
		// Prefer `_all.csv` (all properties, all rows) when Notion exported more
		// than one view of the same database. Every CSV still counts as a view.
		const primary = filesInFolder.find(file => /_all\.csv$/i.test(file.path)) ?? filesInFolder[0]
		databasesByFolder.set(folder, parseDatabaseCsv(primary.path, primary.data))
	}

	const pagesByTitle = new Map<string, RawNotionPage[]>()
	const indexPage = (page: RawNotionPage) => {
		const key = normalizeTitle(page.title)
		const list = pagesByTitle.get(key) ?? []
		list.push(page)
		pagesByTitle.set(key, list)
	}
	for (const page of rawPages) indexPage(page)

	const usedRows = new Set<RawNotionPage>()
	let databaseRows = 0
	for (const db of databasesByFolder.values()) {
		// Notion layouts seen in the wild: rows live in the database folder
		// (`Tasks/`), in a nested folder beside a sibling CSV
		// (`Product/Tasks.csv` + `Product/Tasks/`), or directly under the export
		// wrapper when the CSV is a sibling of its folder. Accept all of them so
		// a row never becomes two pages (one with the body, one with properties).
		const nestedRowFolder = db.folder === db.title ? db.title : `${db.folder}/${db.title}`
		const rowFolders = new Set([db.folder, nestedRowFolder, db.title])
		const synthesizeInto = rawPages.some(page => page.folderPath === nestedRowFolder)
			? nestedRowFolder
			: db.folder

		for (const record of db.records) {
			databaseRows += 1
			const candidates = (pagesByTitle.get(normalizeTitle(record.title)) ?? []).filter(
				page => rowFolders.has(page.folderPath ?? '') && !usedRows.has(page)
			)
			let rowPage = candidates[0]
			if (!rowPage) {
				// A row can be exported without a Markdown file (empty page body).
				// Never drop the row: create the page from its CSV columns.
				rowPage = {
					path: `${db.path}#${databaseRows}`,
					cleanPath: `${synthesizeInto}/${record.title}`,
					title: record.title,
					folderPath: synthesizeInto,
					blockId: null,
					raw: '',
					properties: {},
					synthetic: true,
				}
				rawPages.push(rowPage)
				indexPage(rowPage)
			}
			usedRows.add(rowPage)
			rowPage.properties = record.properties
			rowPage.database = { title: db.title, csvPath: db.path, titleColumn: db.titleColumn }
		}
	}

	// Non-row pages keep their frontmatter properties (already parsed above).
	// Database rows keep their CSV columns, attached when the row was matched.

	// --- Folder pages -------------------------------------------------------
	const folderSet = new Set<string>()
	for (const page of rawPages) {
		if (!page.folderPath) continue
		// The page's own folder is a page in its own right (Notion's nested page
		// folders are real pages), plus every ancestor chain above it.
		folderSet.add(page.folderPath)
		for (const dir of ancestorDirs(page.folderPath)) folderSet.add(dir)
	}
	// An exported database with no rows still gets its folder page, so the
	// deferred-view notice points at a real place in the tree.
	for (const db of databasesByFolder.values()) {
		if (db.folder) {
			folderSet.add(db.folder)
			for (const dir of ancestorDirs(db.folder)) folderSet.add(dir)
		}
	}
	const sortedDirs = [...folderSet].sort((a, b) => a.split('/').length - b.split('/').length)

	// --- Link registry ------------------------------------------------------
	const pagesById = new Map<string, RawNotionPage>()
	for (const page of rawPages) {
		if (page.blockId) pagesById.set(page.blockId, page)
	}
	const existingTitles = new Set(existingPageTitles.map(normalizeTitle))
	const linkStats: LinkStats = { targets: new Map() }
	const stats = {
		attachmentsDropped: 0,
		degradedBlocks: 0,
		calloutsConverted: 0,
		syncedBlocksFlattened: 0,
	}

	const folderPages: ImportPage[] = sortedDirs.map(dir => {
		const segments = dir.split('/')
		return {
			title: segments[segments.length - 1],
			folderPath: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
			properties: {},
			tags: [],
			contentYjsBase64: markdownEngine.seedToYjsBase64(EMPTY_PAGE_DOC),
			plainText: '',
			isFolder: true,
			contentHash: EMPTY_PAGE_CONTENT_HASH,
			provenance: { source: 'notion', sourcePath: dir },
		}
	})

	const notePages: ImportPage[] = rawPages.map(page => {
		const ctx: BodyContext = {
			page,
			media,
			pagesById,
			pagesByTitle,
			databasesByFolder,
			existingTitles,
			linkStats,
			stats,
		}
		const processed = processBody(page, ctx)

		const fitted = fitLiveSchema(markdownEngine.parse(processed))
		const properties = { ...(page.properties ?? {}) }
		return {
			title: page.title,
			folderPath: page.folderPath,
			properties,
			tags: Array.isArray(properties.tags)
				? properties.tags.filter((tag): tag is string => typeof tag === 'string')
				: [],
			contentYjsBase64: markdownEngine.seedToYjsBase64(fitted),
			plainText: markdownEngine.plainText(fitted),
			isFolder: false,
			contentHash: stableHash(canonicalJson(fitted)),
			provenance: {
				source: 'notion',
				sourcePath: page.path,
				...(page.blockId ? { blockId: page.blockId } : {}),
				...(page.database ? { database: page.database } : {}),
			},
		}
	})

	// `processBody` accumulates callout/synced/attachment counts in the shared
	// stats object while each page is parsed.
	const syncedBlocksFlattened = stats.syncedBlocksFlattened

	const totalPages = folderPages.length + notePages.length
	if (notePages.length === 0) {
		throw new Error('No Notion pages or database rows found in that export. Nothing to import.')
	}
	if (totalPages > MAX_IMPORT_PAGES) {
		throw new Error(
			`Export exceeds the maximum of ${MAX_IMPORT_PAGES} pages (${notePages.length} pages + ${folderPages.length} folders). Import it in parts.`
		)
	}

	let linksResolved = 0
	let linksUnresolved = 0
	for (const resolved of linkStats.targets.values()) {
		if (resolved) linksResolved += 1
		else linksUnresolved += 1
	}

	const databaseViewsDeferred = csvFiles.length
	const degradations: ImportDegradation[] = []
	if (databaseViewsDeferred > 0) {
		degradations.push({
			kind: 'database-views',
			count: databaseViewsDeferred,
			message: `${databaseViewsDeferred} database view${databaseViewsDeferred === 1 ? '' : 's'} deferred to Lekhan databases (H2 #47) — rows arrived as pages with their CSV columns as properties; views, filters, sorts and grouping were not recreated.`,
		})
	}
	if (syncedBlocksFlattened > 0) {
		degradations.push({
			kind: 'synced-blocks',
			count: syncedBlocksFlattened,
			message: `${syncedBlocksFlattened} synced block${syncedBlocksFlattened === 1 ? ' was' : 's were'} flattened to static text — edits will not propagate back to Notion.`,
		})
	} else {
		// Name the category even when none were detected: Notion's Markdown
		// export cannot preserve the live link, so "none found" is information,
		// not silence.
		degradations.push({
			kind: 'synced-blocks',
			count: 0,
			message: 'Synced blocks, if any, arrived as static text — Notion’s Markdown export does not preserve their live link.',
		})
	}
	if (stats.attachmentsDropped > 0) {
		degradations.push({
			kind: 'attachments',
			count: stats.attachmentsDropped,
			message: `${stats.attachmentsDropped} non-image attachment${stats.attachmentsDropped === 1 ? '' : 's'} or missing image${stats.attachmentsDropped === 1 ? '' : 's'} were dropped — their labels are kept in the page.`,
		})
	}
	if (content.duplicatePagesSkipped > 0) {
		degradations.push({
			kind: 'duplicate-pages',
			count: content.duplicatePagesSkipped,
			message: `${content.duplicatePagesSkipped} page${content.duplicatePagesSkipped === 1 ? '' : 's'} appeared in more than one export part and ${content.duplicatePagesSkipped === 1 ? 'was' : 'were'} imported once.`,
		})
	}
	if (stats.degradedBlocks > 0) {
		degradations.push({
			kind: 'unsupported-blocks',
			count: stats.degradedBlocks,
			message: `${stats.degradedBlocks} block${stats.degradedBlocks === 1 ? '' : 's'} could not be converted exactly (e.g. embeds or HTML tables) and were kept as text.`,
		})
	}
	degradations.push({
		kind: 'comments',
		count: 0,
		message: 'Notion comments are not included in a Markdown & CSV export, so they were not imported.',
	})
	degradations.push({
		kind: 'formulas-rollups',
		count: 0,
		message: 'Formula and rollup columns arrived as static values from the CSV export; they will not recalculate.',
	})

	const report: NotionImportReport = {
		source: 'notion',
		pages: notePages.length,
		folderPages: folderPages.length,
		linksResolved,
		linksUnresolved,
		degradedBlocks: stats.degradedBlocks,
		degradations,
		databaseViewsDeferred,
		databaseRows,
		syncedBlocksFlattened,
		commentsOmitted: true,
		formulasRollupsFlattened: true,
		attachmentsDropped: stats.attachmentsDropped,
		exportParts: content.parts,
		duplicatePagesSkipped: content.duplicatePagesSkipped,
	}

	return {
		ir: { workspaceId, source: 'notion', pages: [...folderPages, ...notePages] },
		report,
	}
}
