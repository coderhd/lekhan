export type MarkdownPasteKind = 'markdown' | 'codeBlock' | 'default'

const MARKDOWN_INDICATOR_REGEX = /^ {0,3}#+\s|^\s*[-*+]\s|^\s*\d+\.\s|```|^\s*>\s|\*\*.+\*\*|__.+__|\[.+\]\(.+\)|^---$/m

// A GFM table delimiter row, e.g. `| --- | --- |` or `---|---`. Pipes on their
// own (e.g. `read | write | execute`) are NOT enough to mark a paste as a table.
const TABLE_DELIMITER_REGEX = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * Returns true when the text contains a pipe-delimited header row immediately
 * followed by a valid table delimiter row — the GFM requirement for a table.
 */
function hasValidTable(plainText: string): boolean {
	const lines = plainText.split('\n')
	for (let i = 0; i < lines.length - 1; i++) {
		if (lines[i].includes('|') && TABLE_DELIMITER_REGEX.test(lines[i + 1])) {
			return true
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
