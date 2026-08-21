import JSZip from 'jszip'
import { parseFrontmatter, parseMarkdown } from '@/lib/markdown-io'
import { fitLiveSchema } from '@/lib/import-hydration'
import { contentToYjsBase64, contentToPlainText, uint8ArrayToBase64 } from '@/lib/yjs-seed'
import { titleFromFilename } from '@/lib/title-from-filename'

export const MAX_IMPORT_PAGES = 2000
/** Per-file unpacked byte limit for vault entries (shared across all vault readers). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024
/** Aggregate unpacked byte limit across all accepted vault entries. */
export const MAX_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024
/** Maximum number of accepted image attachments (counted separately from Markdown pages). */
export const MAX_IMPORT_IMAGE_COUNT = 1000

export interface VaultEntry {
	/** Vault-relative path with forward slashes, e.g. `guides/foo.md`. */
	path: string
	/** Raw file bytes (utf-8 for markdown, binary for images). */
	data: Uint8Array
}

export interface VaultContent {
	/** Non-skipped files (markdown + images). Images are kept as attachment data for embeds. */
	files: VaultEntry[]
	/** Every directory discovered (including folders with no notes), vault-relative. */
	directories: string[]
}

/** Minimal structural type for the browser File System Access API (TS lib.dom lacks it). */
export interface VaultDirectoryHandle {
	values(): AsyncIterableIterator<VaultEntryHandle>
}
export interface VaultEntryHandle {
	kind: 'file' | 'directory'
	name: string
	getFile(): Promise<File>
	getDirectoryHandle?(): Promise<VaultDirectoryHandle>
}

const SKIP_DIRS = new Set(['.obsidian', '.trash'])
const MARKDOWN_EXT = new Set(['.md', '.markdown'])

/**
 * Feature-detect the File System Access API. Returns `null` where unavailable
 * (Firefox, Safari) so callers can fall back to `<input type="file" webkitdirectory>`.
 */
export function pickVaultDirectory (): Promise<VaultDirectoryHandle | null> {
	const picker = (window as unknown as { showDirectoryPicker?: () => Promise<VaultDirectoryHandle> }).showDirectoryPicker
	if (typeof picker !== 'function') {
		return Promise.resolve(null)
	}
	return Promise.resolve(picker.call(window))
}

function dirname (path: string): string {
	const idx = path.lastIndexOf('/')
	return idx === -1 ? '' : path.slice(0, idx)
}

/**
 * Every ancestor directory of a vault-relative path, shallow-first.
 * `a/b/c.md` → `['a', 'a/b']`. Used so a kept file's complete parent chain
 * becomes folder pages (the write stage builds the nested hierarchy from them).
 */
function ancestorDirs (path: string): string[] {
	const segments = path.split('/')
	const dirs: string[] = []
	for (let i = 1; i < segments.length; i++) {
		dirs.push(segments.slice(0, i).join('/'))
	}
	return dirs
}

function basename (path: string): string {
	return path.split('/').pop() ?? path
}

function extOf (path: string): string {
	const name = basename(path).toLowerCase()
	const idx = name.lastIndexOf('.')
	return idx === -1 ? '' : name.slice(idx)
}

function isSkipped (path: string): boolean {
	const segments = path.split('/')
	if (SKIP_DIRS.has(segments[0])) return true
	const name = basename(path)
	return name.endsWith('.canvas') || name.startsWith('.')
}

function isMarkdown (path: string): boolean {
	return MARKDOWN_EXT.has(extOf(path))
}

function isImage (path: string): boolean {
	return /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(basename(path))
}

/** Normalize a raw path (strip leading `/`, collapse `./`, drop trailing `/` for dirs). */
function normalizePath (path: string): string {
	return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/\.\//g, '/')
}

/**
 * Read a `File` as bytes. jsdom (the test environment) lacks
 * `File.prototype.arrayBuffer`, so fall back to a `FileReader`.
 */
function fileToUint8Array (file: File): Promise<Uint8Array> {
	if (typeof file.arrayBuffer === 'function') {
		return file.arrayBuffer().then((buf) => new Uint8Array(buf))
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
		reader.readAsArrayBuffer(file)
	})
}

export async function readVaultZip (zipFile: File): Promise<VaultContent> {
	const zip = await JSZip.loadAsync(zipFile)
	const files: VaultEntry[] = []
	const directories = new Set<string>()
	const rawKeys = Object.keys(zip.files)
	const allFileEntries = rawKeys.filter((k) => !zip.files[k].dir)
	let totalBytes = 0
	let imageCount = 0

	for (const rawPath of rawKeys) {
		const path = normalizePath(rawPath)
		if (!path) continue
		const entry = zip.files[rawPath]
		if (entry.dir) {
			if (isSkipped(path)) continue
			// Only genuinely empty folders become folder pages: a directory
			// that holds only skipped files (e.g. `notes/bin.dat`) is not an
			// Obsidian folder to recreate. Non-empty dirs are covered by the
			// dirname of their kept files below.
			const hasFileInside = allFileEntries.some((k) => normalizePath(k).startsWith(`${path}/`))
			if (!hasFileInside) directories.add(path)
			continue
		}
		if (isSkipped(path)) continue
		if (!isMarkdown(path) && !isImage(path)) continue
		const isImg = isImage(path)
		// Validate against reported uncompressed size before decompressing to avoid zip-bomb OOM.
		const maybeData: unknown = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
		const reportedSize =
			maybeData && typeof (maybeData as { uncompressedSize?: unknown }).uncompressedSize === 'number'
				? (maybeData as { uncompressedSize: number }).uncompressedSize
				: undefined
		if (reportedSize !== undefined) {
			if (reportedSize > MAX_IMPORT_FILE_BYTES) {
				throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
			}
			if (totalBytes + reportedSize > MAX_IMPORT_TOTAL_BYTES) {
				throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
			}
		}
		if (isImg && imageCount + 1 > MAX_IMPORT_IMAGE_COUNT) {
			throw new Error(`Vault exceeds maximum number of image attachments (${MAX_IMPORT_IMAGE_COUNT}).`)
		}
		const data = await entry.async('uint8array')
		if (data.length > MAX_IMPORT_FILE_BYTES) {
			throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
		}
		if (totalBytes + data.length > MAX_IMPORT_TOTAL_BYTES) {
			throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
		}
		totalBytes += data.length
		if (isImg) imageCount += 1
		files.push({ path, data })
		for (const dir of ancestorDirs(path)) directories.add(dir)
	}

	return { files, directories: [...directories] }
}

/**
 * `webkitdirectory` fallback. Each `File` carries `webkitRelativePath`
 * (`<pickedRoot>/<relative>`); the first segment is the folder the user
 * selected, so it is stripped to make paths vault-relative.
 */
export async function readVaultFiles (files: File[]): Promise<VaultContent> {
	const entries: VaultEntry[] = []
	const directories = new Set<string>()
	let totalBytes = 0
	let imageCount = 0

	for (const file of files) {
		const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name
		const path = normalizePath(rel.replace(/^[^/]+\//, ''))
		if (!path) continue
		if (isSkipped(path)) continue
		if (!isMarkdown(path) && !isImage(path)) continue
		const isImg = isImage(path)
		if (file.size > MAX_IMPORT_FILE_BYTES) {
			throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
		}
		if (totalBytes + file.size > MAX_IMPORT_TOTAL_BYTES) {
			throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
		}
		if (isImg && imageCount + 1 > MAX_IMPORT_IMAGE_COUNT) {
			throw new Error(`Vault exceeds maximum number of image attachments (${MAX_IMPORT_IMAGE_COUNT}).`)
		}
		const data = await fileToUint8Array(file)
		if (data.length > MAX_IMPORT_FILE_BYTES) {
			throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
		}
		if (totalBytes + data.length > MAX_IMPORT_TOTAL_BYTES) {
			throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
		}
		totalBytes += data.length
		if (isImg) imageCount += 1
		entries.push({ path, data })
		for (const dir of ancestorDirs(path)) directories.add(dir)
	}

	return { files: entries, directories: [...directories] }
}

/**
 * `showDirectoryPicker` walker. Recursively reads files and records every
 * directory (including empty ones), producing vault-relative paths.
 */
export async function readVaultDirectory (handle: VaultDirectoryHandle): Promise<VaultContent> {
	const files: VaultEntry[] = []
	const directories = new Set<string>()
	let totalBytes = 0
	let imageCount = 0

	async function walk (dir: VaultDirectoryHandle, prefix: string): Promise<void> {
		for await (const entry of dir.values()) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.kind === 'directory') {
				if (isSkipped(path)) continue
				directories.add(path)
				await walk(await entry.getDirectoryHandle!(), path)
			} else {
				if (isSkipped(path)) continue
				if (!isMarkdown(path) && !isImage(path)) continue
				const isImg = isImage(path)
				const file = await entry.getFile()
				if (file.size > MAX_IMPORT_FILE_BYTES) {
					throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
				}
				if (totalBytes + file.size > MAX_IMPORT_TOTAL_BYTES) {
					throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
				}
				if (isImg && imageCount + 1 > MAX_IMPORT_IMAGE_COUNT) {
					throw new Error(`Vault exceeds maximum number of image attachments (${MAX_IMPORT_IMAGE_COUNT}).`)
				}
				const data = await fileToUint8Array(file)
				if (data.length > MAX_IMPORT_FILE_BYTES) {
					throw new Error(`File "${path}" exceeds per-file limit of ${MAX_IMPORT_FILE_BYTES} bytes.`)
				}
				if (totalBytes + data.length > MAX_IMPORT_TOTAL_BYTES) {
					throw new Error(`Vault exceeds total unpacked size limit of ${MAX_IMPORT_TOTAL_BYTES} bytes.`)
				}
				totalBytes += data.length
				if (isImg) imageCount += 1
				files.push({ path, data })
			}
		}
	}

	await walk(handle, '')
	return { files, directories: [...directories] }
}

export interface ObsidianImportPage {
	title: string
	folderPath: string | null
	properties: Record<string, unknown>
	tags: string[]
	contentYjsBase64: string
	plainText: string
	isFolder: boolean
}

export interface ObsidianImportIR {
	workspaceId: string
	pages: ObsidianImportPage[]
}

export interface ObsidianImportReport {
	pages: number
	folderPages: number
	linksResolved: number
	linksUnresolved: number
	degradedBlocks: number
}

export interface ObsidianImportResult {
	ir: ObsidianImportIR
	report: ObsidianImportReport
}

export interface ObsidianImportOptions {
	workspaceId: string
	/** Titles of pages already in the workspace, used to resolve wikilinks in the report. */
	existingPageTitles: string[]
}

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

// Mirrors server/graph-index.js normalizeTitle (client bundle cannot import server CJS).
function normalizeTitle (title: string): string {
	return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Mirrors server/graph-index.js MARKDOWN_LINK_RE.
const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g

function extractWikilinks (text: string): string[] {
	const targets: string[] = []
	const seen = new Set<string>()
	let match
	WIKILINK_RE.lastIndex = 0
	while ((match = WIKILINK_RE.exec(text)) !== null) {
		const target = match[1].trim()
		if (!target) continue
		const key = normalizeTitle(target)
		if (seen.has(key)) continue
		seen.add(key)
		targets.push(target)
	}
	return targets
}

const EMBED_RE = /!\[\[([^\]]+)\]\]/g

function imageExtOf (name: string): string | null {
	const m = /\.([a-z0-9]+)$/i.exec(name)
	return m ? m[1].toLowerCase() : null
}

interface ImageIndex {
	/** Lowercased vault-relative path → image file. */
	byPath: Map<string, VaultEntry>
	/** Lowercased basename → image files (may be ambiguous). */
	byBasename: Map<string, VaultEntry[]>
}

/**
 * Resolve an embed target (`![[...]]` inner text, alias/size stripped) to an
 * image file for the note at `notePath`. Precedence mirrors Obsidian: exact
 * vault-relative path, then the note's own folder, then a unique basename
 * match. Duplicate basenames are ambiguous and resolve to nothing rather than
 * an arbitrary file (the embed degrades to a wikilink and is reported).
 */
function resolveImage (target: string, notePath: string, index: ImageIndex): VaultEntry | null {
	const lower = target.toLowerCase()
	if (target.includes('/')) {
		return index.byPath.get(lower) ?? null
	}
	const noteFolder = dirname(notePath)
	if (noteFolder) {
		const viaNote = index.byPath.get(`${noteFolder}/${target}`.toLowerCase())
		if (viaNote) return viaNote
	}
	const candidates = index.byBasename.get(lower)
	if (candidates && candidates.length === 1) return candidates[0]
	return null
}

/**
 * Rewrite `![[...]]` embeds in a body before markdown parsing:
 * image embeds that resolve to a vault attachment become `![alt](data:image/...;base64,...)`
 * markdown image syntax (parsed into a real image node); everything else degrades to a
 * `[[wikilink]]` and increments `degraded`.
 */
function processEmbeds (body: string, imageIndex: ImageIndex, notePath: string, degraded: { count: number }): string {
	return body.replace(EMBED_RE, (whole, innerRaw: string) => {
		const inner = innerRaw.trim()
		const target = inner.split('|')[0].trim() // drop Obsidian size/alias suffix
		const ext = imageExtOf(target)
		const entry = ext && IMAGE_MIME[ext] ? resolveImage(target, notePath, imageIndex) : null
		if (entry) {
			const mime = IMAGE_MIME[ext!]
			return `![${target}](data:${mime};base64,${uint8ArrayToBase64(entry.data)})`
		}
		degraded.count += 1
		return `[[${inner}]]`
	})
}

const EMPTY_PAGE_DOC = {
	type: 'doc',
	content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
}

/**
 * Normalize a vault into the IR + report. Pure and synchronous (parsing and
 * Yjs seeding are both sync); the async part is reading the vault (see
 * `readVaultZip` / `readVaultFiles` / `readVaultDirectory`).
 */
export function importObsidianVault (content: VaultContent, options: ObsidianImportOptions): ObsidianImportResult {
	const { workspaceId, existingPageTitles } = options
	const notePages: ObsidianImportPage[] = []
	const folderPages: ObsidianImportPage[] = []
	const degraded = { count: 0 }

	// Index image files for embed resolution: by vault-relative path and by
	// basename (basename entries can be ambiguous — resolution guards against
	// picking an arbitrary file when a name is duplicated across folders).
	const imageIndex: ImageIndex = { byPath: new Map(), byBasename: new Map() }
	for (const file of content.files) {
		if (!isImage(file.path)) continue
		imageIndex.byPath.set(file.path.toLowerCase(), file)
		const base = basename(file.path).toLowerCase()
		const list = imageIndex.byBasename.get(base) ?? []
		list.push(file)
		imageIndex.byBasename.set(base, list)
	}

	// Folder pages: every discovered directory, including empty ones, ordered
	// shallow-first so the write stage can build the parent chain.
	const sortedDirs = [...content.directories].sort((a, b) => a.split('/').length - b.split('/').length)
	for (const dir of sortedDirs) {
		const segments = dir.split('/')
		folderPages.push({
			title: segments[segments.length - 1],
			folderPath: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
			properties: {},
			tags: [],
			contentYjsBase64: contentToYjsBase64(EMPTY_PAGE_DOC),
			plainText: '',
			isFolder: true,
		})
	}

	for (const file of content.files) {
		if (!file.path.toLowerCase().endsWith('.md') && !file.path.toLowerCase().endsWith('.markdown')) continue

		const raw = new TextDecoder().decode(file.data)
		const { data, body } = parseFrontmatter(raw)

		const title = data.title ?? titleFromFilename(file.path.split('/').pop() ?? '')

		const properties: Record<string, unknown> = { ...data.properties }
		if (data.tags && data.tags.length > 0) {
			properties.tags = data.tags
		}

		const processedBody = processEmbeds(body, imageIndex, file.path, degraded)
		const fitted = fitLiveSchema(parseMarkdown(processedBody))

		notePages.push({
			title,
			folderPath: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null,
			properties,
			tags: data.tags ?? [],
			contentYjsBase64: contentToYjsBase64(fitted),
			plainText: contentToPlainText(fitted),
			isFolder: false,
		})
	}

	if (notePages.length === 0) {
		throw new Error('No markdown files found in the vault. Nothing to import.')
	}
	if (notePages.length > MAX_IMPORT_PAGES) {
		throw new Error(`Vault exceeds the maximum of ${MAX_IMPORT_PAGES} pages. Split the vault and import in parts.`)
	}

	// Resolve wikilinks against imported titles ∪ existing workspace titles.
	// Counts are distinct normalized targets across ALL note plainTexts (a
	// link back-linked from ten notes is one resolved target).
	const knownTitles = new Set([
		...notePages.map((p) => normalizeTitle(p.title)),
		...existingPageTitles.map(normalizeTitle),
	])
	const distinctTargets = new Map<string, string>()
	for (const page of notePages) {
		for (const target of extractWikilinks(page.plainText)) {
			distinctTargets.set(normalizeTitle(target), target)
		}
	}
	let linksResolved = 0
	let linksUnresolved = 0
	for (const normalized of distinctTargets.keys()) {
		if (knownTitles.has(normalized)) {
			linksResolved += 1
		} else {
			linksUnresolved += 1
		}
	}

	const pages = [...folderPages, ...notePages]
	return {
		ir: { workspaceId, pages },
		report: {
			pages: notePages.length,
			folderPages: folderPages.length,
			linksResolved,
			linksUnresolved,
			degradedBlocks: degraded.count,
		},
	}
}