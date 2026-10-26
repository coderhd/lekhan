/**
 * Shared import safety envelope. The Obsidian and Notion producers both read
 * archives client-side, so they must enforce the same bounds rather than each
 * growing its own (and letting one drift).
 */

export const MAX_IMPORT_PAGES = 2000
/** Per-file unpacked byte limit for archive entries (shared across all readers). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024
/** Aggregate unpacked byte limit across all accepted archive entries. */
export const MAX_IMPORT_TOTAL_BYTES = 100 * 1024 * 1024
/** Maximum number of accepted image attachments (counted separately from pages). */
export const MAX_IMPORT_IMAGE_COUNT = 1000
