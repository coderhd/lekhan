export type MarkdownPasteKind = 'markdown' | 'codeBlock' | 'default'

const MARKDOWN_INDICATOR_REGEX = /^#+\s|^\s*[-*+]\s|^\s*\d+\.\s|```|^\s*>\s|\*\*.+\*\*|__.+__|\[.+\]\(.+\)|\|.+\||^---$/m

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
	if (MARKDOWN_INDICATOR_REGEX.test(plainText)) return 'markdown'
	if (htmlText && (htmlText.includes('<pre') || htmlText.includes('<code'))) return 'codeBlock'
	return 'default'
}
