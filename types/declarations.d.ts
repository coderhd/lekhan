declare module 'html-to-docx' {
	interface MarginOptions {
		top?: number
		right?: number
		bottom?: number
		left?: number
	}

	interface HtmlToDocxOptions {
		title?: string
		margin?: MarginOptions
		[key: string]: any
	}

	function htmlToDocx(
		htmlString: string,
		headerHTMLString?: string | null,
		documentOptions?: HtmlToDocxOptions,
		footerHTMLString?: string | null
	): Promise<Blob | Buffer>

	export default htmlToDocx
}

declare module 'tippy.js' {
	const tippy: any
	export default tippy
}

