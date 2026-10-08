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

// Obsidian markers. Frontmatter/callout are *structural* (they never appear in
// ordinary prose or code); a wikilink is a softer signal (code also uses
// `[[…]]` indexing), so it is kept separate from `hasObsidianStructure` and
// only overrides a code-block decision when the HTML is Obsidian's own.
// Inline `#tags` are intentionally not a classifier signal — they appear in
// prose and code comments; tags still index from the pasted body.
const OBSIDIAN_FRONTMATTER_RE = /^---\r?\n/
const OBSIDIAN_CALLOUT_RE = /^\s*>\s*\[![a-zA-Z0-9 ]+\]/m
const WIKILINK_RE = /\[\[[^[\]]+\]\]/

// Notion's clipboard HTML carries data/class markers or links to a Notion host.
// The host is matched by parsing each URL and comparing its hostname, so a
// foreign URL whose *path* merely looks Notion-ish (e.g.
// `https://example.com/notion.so/guide`) is not mistaken for Notion content.
const NOTION_MARKER_RE = /data-notion|class=["'][^"']*notion/i
const NOTION_HOSTS = new Set(['notion.so', 'www.notion.so', 'notion.site', 'www.notion.site'])
const HREF_RE = /(?:href|src)\s*=\s*["']([^"']*)["']/gi

/** True when `hostname` belongs to a Notion host (`www.` optional). */
export function isNotionHostname(hostname: string): boolean {
	return NOTION_HOSTS.has(hostname.toLowerCase().replace(/\.$/, ''))
}

/**
 * True when `href` points at a Notion page. The URL is parsed and its hostname
 * compared — `https://example.com/notion.so/guide` is *not* a Notion link.
 * Scheme-less values (`www.notion.so/x`) are retried with an `https://` prefix.
 */
export function isNotionUrl(href: string): boolean {
	if (!href) return false
	let url: URL
	try {
		url = new URL(href)
	} catch {
		try {
			url = new URL(`https://${href}`)
		} catch {
			return false
		}
	}
	return isNotionHostname(url.hostname)
}

// Obsidian's own clipboard HTML links wikilinks through its custom URL scheme
// (`obsidian://open?…`), which never appears in code or any other app.
const OBSIDIAN_HTML_RE = /obsidian:\/\//i

// Structural signals that only ever occur in the Obsidian dialect (never in
// ordinary prose or code): leading YAML frontmatter or a callout marker. A bare
// `[[...]]` is deliberately excluded here because it is also valid array
// indexing in source code (`matrix[[i]][[j]]`, `arr = [[1]]`).
function hasObsidianStructure(text: string): boolean {
	return OBSIDIAN_FRONTMATTER_RE.test(text) || OBSIDIAN_CALLOUT_RE.test(text)
}

export function isObsidianMarkdown(text: string | undefined): boolean {
	if (typeof text !== 'string') return false
	return hasObsidianStructure(text) || WIKILINK_RE.test(text)
}

export function isNotionHtml(html: string | undefined): boolean {
	if (typeof html !== 'string') return false
	if (NOTION_MARKER_RE.test(html)) return true
	// Fresh regex per call: the module-level `/g` regex would carry lastIndex
	// state across calls.
	const hrefRe = new RegExp(HREF_RE.source, 'gi')
	let match: RegExpExecArray | null
	while ((match = hrefRe.exec(html)) !== null) {
		if (isNotionUrl(match[1])) return true
	}
	return false
}

/** True when the clipboard HTML came from Obsidian itself (custom URL scheme). */
export function isObsidianHtml(html: string | undefined): boolean {
	return typeof html === 'string' && OBSIDIAN_HTML_RE.test(html)
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
	const generic = decideMarkdownPaste(plainText, htmlText)
	// A real code block copied from an editor must stay a code block even when
	// it happens to contain `[[…]]` (array indexing). It only yields to an
	// unambiguous Obsidian signal: leading frontmatter/a callout, or Obsidian's
	// own clipboard HTML. A bare `[[…]]` is too weak to tell a wiki page from
	// code on its own.
	const obsidianSignal = hasObsidianStructure(plainText) || isObsidianHtml(htmlText)
	if (generic === 'codeBlock' && !obsidianSignal) return 'codeBlock'
	if (isObsidianMarkdown(plainText) || isObsidianHtml(htmlText)) return 'obsidian-markdown'
	if (isNotionHtml(htmlText)) return 'notion-html'
	return generic
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
