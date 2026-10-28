import { strToU8, zipSync } from 'fflate'

/**
 * Production, client-side zip *writer* (SIL-9 S4, plan §1 gap 3). Until now
 * zips were only ever read (JSZip `loadAsync` in the importer); there was no
 * create path outside test code. This module is the single writer: pure, no
 * `fetch`, no DOM, no filesystem — safe to call from the browser main thread
 * or a Worker so "leaving is always possible regardless of service status"
 * (story 13).
 */

export interface ZipEntry {
	/** Vault-relative path with forward slashes, e.g. `guides/intro.md`. */
	path: string
	/** Text is UTF-8 encoded; pass bytes for binary attachments. */
	data: Uint8Array | string
}

function toBytes(data: Uint8Array | string): Uint8Array {
	return typeof data === 'string' ? strToU8(data) : data
}

/**
 * Build the zip bytes in memory. Directory entries are implied by the file
 * paths (Obsidian materializes folders from paths), so callers never add
 * explicit directory entries. A duplicate path is a programmer error — it
 * would silently overwrite a note — so it throws instead.
 */
export function buildZipBytes(entries: ZipEntry[]): Uint8Array {
	const table: Record<string, Uint8Array> = {}
	for (const entry of entries) {
		const path = entry.path.replace(/^\/+/, '')
		if (path === '') {
			throw new Error('Zip entry path must not be empty.')
		}
		if (Object.prototype.hasOwnProperty.call(table, path)) {
			throw new Error(`Duplicate zip entry path: ${path}`)
		}
		table[path] = toBytes(entry.data)
	}
	// level 6: the usual speed/size knee for text-heavy vaults; a fixed mtime
	// keeps the output deterministic (fflate rejects the 1970 epoch) so the
	// same workspace always yields the same bytes.
	return zipSync(table, { level: 6, mtime: 946684800000 })
}

/** Convenience for the browser download path. */
export function buildZipBlob(entries: ZipEntry[]): Blob {
	return new Blob([buildZipBytes(entries) as BlobPart], { type: 'application/zip' })
}
