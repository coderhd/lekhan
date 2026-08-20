import JSZip from 'jszip'

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
		const data = await entry.async('uint8array')
		files.push({ path, data })
		const dir = dirname(path)
		if (dir) directories.add(dir)
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

	for (const file of files) {
		const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name
		const path = normalizePath(rel.replace(/^[^/]+\//, ''))
		if (!path) continue
		if (isSkipped(path)) continue
		if (!isMarkdown(path) && !isImage(path)) continue
		const data = await fileToUint8Array(file)
		entries.push({ path, data })
		const dir = dirname(path)
		if (dir) directories.add(dir)
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

	async function walk (dir: VaultDirectoryHandle, prefix: string): Promise<void> {
		for await (const entry of dir.values()) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.kind === 'directory') {
				directories.add(path)
				await walk(await entry.getDirectoryHandle!(), path)
			} else {
				if (isSkipped(path)) continue
				if (!isMarkdown(path) && !isImage(path)) continue
				const file = await entry.getFile()
				files.push({ path, data: await fileToUint8Array(file) })
			}
		}
	}

	await walk(handle, '')
	return { files, directories: [...directories] }
}