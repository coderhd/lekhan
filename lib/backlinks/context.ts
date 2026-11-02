/**
 * One-line context for a backlink row.
 *
 * The v1 backlink query (`fetchPageBacklinks`) only carries the linking page's
 * title, so most rows are title-only. When a caller does have the linking page
 * body, this derivation keeps the row to a single 120-character window centred
 * on the `[[Target]]` match (or a plain title mention) and marks clipped edges
 * with an ellipsis. It never scans for content on the caller's behalf: body is
 * opt-in, which keeps the backlink query untouched (Graph spec GV-T3).
 */
export const BACKLINK_CONTEXT_LENGTH = 120

const ELLIPSIS = '…'
const WIKILINK = (target: string) => `[[${target}]]`

export function buildBacklinkContext (
	body: string | null | undefined,
	target: string,
	maxLength: number = BACKLINK_CONTEXT_LENGTH
): string | undefined {
	if (!body) return undefined

	const text = body.replace(/\s+/g, ' ').trim()
	if (!text) return undefined
	if (text.length <= maxLength) return text

	const lowerText = text.toLowerCase()
	const needle = target.trim()
	const matchIndex = needle
		? (() => {
			const wikilinkIndex = lowerText.indexOf(WIKILINK(needle).toLowerCase())
			return wikilinkIndex >= 0 ? wikilinkIndex : Math.max(0, lowerText.indexOf(needle.toLowerCase()))
		})()
		: 0

	// Reserve two characters for a possible ellipsis on each clipped edge.
	const windowSize = Math.max(1, maxLength - 2)
	const half = Math.floor(windowSize / 2)
	let start = Math.max(0, matchIndex - half)
	const end = Math.min(text.length, start + windowSize)
	if (end === text.length) {
		start = Math.max(0, end - windowSize)
	}

	const snippet = text.slice(start, end)
	const prefix = start > 0 ? ELLIPSIS : ''
	const suffix = end < text.length ? ELLIPSIS : ''
	return `${prefix}${snippet}${suffix}`
}
