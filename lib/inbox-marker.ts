/**
 * One matcher for the `#inbox` capture marker.
 *
 * Mirrors `server/graph-index.js` TAG_RE exactly: a tag may start at the
 * beginning of the text, after whitespace, or after `(`. It ends at any
 * character outside `[a-zA-Z0-9_-/]`. Counting (`lib/inbox.ts`), triage
 * (`lib/inbox-triage.ts`), and capture (`lib/quick-capture.ts`) all use this,
 * so `#inboxing`, `#inbox_notes`, `#inbox-2026`, and `#inbox/foo` are
 * different tags while `#inbox`, `#inbox.`, and `(#inbox)` are the marker.
 */
export const INBOX_TAG = 'inbox'

export const INBOX_MARKER_SOURCE = '(^|[\\s(])#inbox(?![a-zA-Z0-9_\\-/])'

const INBOX_MARKER_RE = new RegExp(INBOX_MARKER_SOURCE, 'i')
// `(#inbox)` is a marker wrapped in parentheses; remove the whole wrapper so
// stripping never leaves a dangling `()`.
const PARENTHESIZED_MARKER_RE = /\(\s*#inbox\s*\)/gi

/** True when `text` contains the standalone `#inbox` marker. */
export function hasInboxMarker (text: string | null | undefined): boolean {
	return INBOX_MARKER_RE.test(String(text ?? ''))
}

/** Remove the marker while preserving the character that preceded it. */
export function stripInboxMarker (text: string): string {
	return String(text ?? '')
		.replace(PARENTHESIZED_MARKER_RE, ' ')
		.replace(new RegExp(INBOX_MARKER_SOURCE, 'gi'), (_match, prefix: string) => prefix ?? '')
		.replace(/\s{2,}/g, ' ')
		.trim()
}
