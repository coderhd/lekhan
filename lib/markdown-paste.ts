export type MarkdownPasteKind = 'markdown' | 'codeBlock' | 'default'

/**
 * Source-aware clipboard classification. Narrows the generic markdown/code
 * decision with the two dialects this slice accepts: Obsidian-dialect markdown
 * and Notion-copied HTML. Existing callers of `decideMarkdownPaste` keep their
 * contract; `obsidian-markdown` is the only value that also flows to the
 * markdown parser.
 */
export type ClipboardPasteKind =
	| 'obsidian-markdown'
	| 'notion-html'
	| 'markdown'
	| 'codeBlock'
	| 'default'

const MARKDOWN_INDICATOR_REGEX = /^ {0,3}#+\s|^\s*[-*+]\s|^\s*\d+\.\s|```|^\s*>\s|\*\*.+\*\*|__.+__|\[.+\]\(.+\)|^---$/m

// Strong Obsidian signals only: YAML frontmatter, a callout marker, or a
// wikilink. Inline `#tags` are intentionally excluded — they also appear in
// plain prose and code comments, so on their own they must not divert a paste
// away from the code-block branch. Tags still index from the pasted body.
const OBSIDIAN_FRONTMATTER_RE = /^---\r?\n/
const OBSIDIAN_CALLOUT_RE = /^\s*>\s*\[![a-zA-Z0-9 ]+\]/m
const WIKILINK_RE = /\[\[[^[\]]+\]\]/

// Notion's clipboard HTML carries its own host or data/class markers.
const NOTION_HTML_RE = /(?:www\.)?notion\.(?:so|site)|data-notion|class="[^"]*notion/i

export function isObsidianMarkdown(text: string | undefined): boolean {
	if (typeof text !== 'string') return false
	return (
		OBSIDIAN_FRONTMATTER_RE.test(text) ||
		OBSIDIAN_CALLOUT_RE.test(text) ||
		WIKILINK_RE.test(text)
	)
}

export function isNotionHtml(html: string | undefined): boolean {
	return typeof html === 'string' && NOTION_HTML_RE.test(html)
}

/**
 * Classify a clipboard payload by dialect:
 * - Obsidian signals win (they are unambiguous and must route to the markdown
 *   parser even when Notion also tagged the HTML).
 * - Notion HTML routes to the Notion converter when the plain text carries no
 *   Obsidian signals.
 * - Otherwise fall back to the existing generic decision.
 */
export function classifyClipboardPaste(
	plainText: string | undefined,
	htmlText: string | undefined,
): ClipboardPasteKind {
	if (!plainText) return 'default'
	if (isObsidianMarkdown(plainText)) return 'obsidian-markdown'
	if (isNotionHtml(htmlText)) return 'notion-html'
	return decideMarkdownPaste(plainText, htmlText)
}

// A GFM table delimiter row, e.g. `| --- | --- |` or `---|---`. Pipes on their
// own (e.g. `read | write | execute`) are NOT enough to mark a paste as a table.
const TABLE_DELIMITER_REGEX = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * Counts the cells in a table row after normalizing whitespace and stripping
 * outer pipes, e.g. `| Name | Role |` -> 2.
 */
function countCells(row: string): number {
	return row
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map((cell) => cell.trim())
		.filter((cell) => cell.length > 0).length
}

/**
 * Returns true when the text contains a pipe-delimited header row immediately
 * followed by a valid table delimiter row with the same number of cells — the
 * GFM requirement for a table. Mismatched rows (e.g. header with 3 cells over
 * a delimiter row with 2) are not tables.
 */
function hasValidTable(plainText: string): boolean {
	const lines = plainText.split('\n')
	for (let i = 0; i < lines.length - 1; i++) {
		if (lines[i].includes('|') && TABLE_DELIMITER_REGEX.test(lines[i + 1])) {
			if (countCells(lines[i]) === countCells(lines[i + 1])) {
				return true
			}
		}
	}
	return false
}

/**
 * Decide how pasted text should be inserted based on the plain text and any
 * HTML accompanying it on the clipboard.
 *
 * Markdown is parsed into rich blocks whenever the source text shows markdown
 * indicators — even if the clipboard HTML also wraps the content in
 * `<pre>`/`<code>` (a common side effect of copying from source views like
 * GitHub raw, IDEs, and chat apps). Only treat the paste as a single code
 * block when the text is not markdown-like but the HTML still indicates code.
 */
export function decideMarkdownPaste(
	plainText: string | undefined,
	htmlText: string | undefined,
): MarkdownPasteKind {
	if (!plainText) return 'default'
	if (MARKDOWN_INDICATOR_REGEX.test(plainText) || hasValidTable(plainText)) return 'markdown'
	if (htmlText && (htmlText.includes('<pre') || htmlText.includes('<code'))) return 'codeBlock'
	return 'default'
}
