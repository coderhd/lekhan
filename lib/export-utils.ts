import { AlignmentType, Document as DocxDocument, ExternalHyperlink, HeadingLevel, ImageRun, NumberFormat, Packer, Paragraph, ShadingType, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, TextRun, VerticalAlign, WidthType } from 'docx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { slugifyTitle } from '@/lib/markdown-export'

/** A4 page geometry shared by the PDF exporter and its tests. */
export const PDF_PAGE = { width: 210, height: 297, margin: 12 }

export const PDF_JPEG_QUALITY = 0.92

/** Deepest list nesting the numbering config defines (levels 0-4). */
const MAX_LIST_DEPTH = 4

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
	URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* DOCX                                                                 */
/* ------------------------------------------------------------------ */

const BODY_SPACING = { before: 100, after: 100 }
const CODE_SPACING = { before: 60, after: 120 }

type DocxInline = TextRun | ExternalHyperlink | ImageRun
type DocxBlock = Paragraph | DocxTable

interface RunMarks {
	bold?: boolean
	italics?: boolean
	underline?: Record<string, never>
	strike?: boolean
	font?: string
}

/**
 * Numbering definition for ordered lists in the exported document, with five
 * nesting levels of increasing indentation. Bullet lists use Word's built-in
 * bullet style, so only the ordered reference needs a definition.
 */
export const NUMBERING_CONFIG = {
	config: [
		{
			reference: 'lekhan-ordered',
			levels: Array.from({ length: 5 }, (_, level) => ({
				level,
				format: NumberFormat.DECIMAL,
				text: `%${level + 1}.`,
				alignment: AlignmentType.START,
				style: { paragraph: { indent: { left: (level + 1) * 720, hanging: 360 } } },
			})),
		},
	],
}

const ORDERED_REFERENCE = 'lekhan-ordered'

const HEADING_LEVELS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
	h1: HeadingLevel.HEADING_1,
	h2: HeadingLevel.HEADING_2,
	h3: HeadingLevel.HEADING_3,
	h4: HeadingLevel.HEADING_4,
	h5: HeadingLevel.HEADING_5,
	h6: HeadingLevel.HEADING_6,
}

function alignmentFrom(node: Element) {
	switch ((node as HTMLElement).style?.textAlign) {
		case 'center': return AlignmentType.CENTER
		case 'right': return AlignmentType.RIGHT
		case 'justify': return AlignmentType.JUSTIFIED
		default: return undefined
	}
}

function buildRuns(node: Node, marks: RunMarks): DocxInline[] {
	const out: DocxInline[] = []
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent || ''
			if (text) {
				out.push(new TextRun({ text, ...marks }))
			}
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const el = child as HTMLElement
			const tag = el.tagName.toLowerCase()
			switch (tag) {
				case 'br':
					out.push(new TextRun({ break: 1 }))
					break
				case 'strong':
				case 'b':
					out.push(...buildRuns(el, { ...marks, bold: true }))
					break
				case 'em':
				case 'i':
					out.push(...buildRuns(el, { ...marks, italics: true }))
					break
				case 'u':
					out.push(...buildRuns(el, { ...marks, underline: {} }))
					break
				case 's':
				case 'strike':
				case 'del':
					out.push(...buildRuns(el, { ...marks, strike: true }))
					break
				case 'code':
					out.push(...buildRuns(el, { ...marks, font: 'Courier New' }))
					break
				case 'a': {
					const href = el.getAttribute('href')
					const children = buildRuns(el, marks)
					if (href) {
						out.push(new ExternalHyperlink({ link: href, children }))
					} else {
						out.push(...children)
					}
					break
				}
				case 'img': {
					const src = el.getAttribute('src') || ''
					const match = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/)
					if (match) {
						const type = match[1] === 'image/jpeg' ? 'jpg' : 'png'
						out.push(new ImageRun({
							type,
							data: match[2],
							transformation: {
								width: Number(el.getAttribute('width')) || 120,
								height: Number(el.getAttribute('height')) || 90,
							},
						}))
					}
					break
				}
				default:
					out.push(...buildRuns(el, marks))
					break
			}
		}
	}
	return out
}

function isListTag(node: Element): boolean {
	const tag = node.tagName.toLowerCase()
	return tag === 'ul' || tag === 'ol'
}

function buildList(listEl: Element, isOrdered: boolean, depth: number, marks: RunMarks = {}): DocxBlock[] {
	const out: DocxBlock[] = []
	for (const li of Array.from(listEl.children).filter((child) => child.tagName.toLowerCase() === 'li')) {
		const textEl = li.cloneNode(false) as HTMLElement
		for (const child of Array.from(li.childNodes)) {
			if (child.nodeType === Node.ELEMENT_NODE && isListTag(child as Element)) {
				continue
			}
			textEl.appendChild(child.cloneNode(true))
		}
		const runs = buildRuns(textEl, marks)
		const level = Math.min(depth, MAX_LIST_DEPTH)
		const opts = { children: runs, spacing: BODY_SPACING }
		if (isOrdered) {
			out.push(new Paragraph({ ...opts, numbering: { reference: ORDERED_REFERENCE, level } }))
		} else {
			out.push(new Paragraph({ ...opts, bullet: { level } }))
		}
		for (const nested of Array.from(li.children).filter(isListTag)) {
			out.push(...buildList(nested, nested.tagName.toLowerCase() === 'ol', depth + 1, marks))
		}
	}
	return out
}

const BLOCK_CONTAINING_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'HR', 'DIV'])

function cellContent(cell: Element, isHeader: boolean): DocxBlock[] {
	const hasBlocks = Array.from(cell.children).some((child) => BLOCK_CONTAINING_TAGS.has(child.tagName))
	if (hasBlocks) {
		return buildDocxChildren(cell.outerHTML, isHeader ? { bold: true } : {})
	}
	const runs = buildRuns(cell, isHeader ? { bold: true } : {})
	return runs.length > 0
		? [new Paragraph({ children: runs, spacing: BODY_SPACING })]
		: [new Paragraph({ children: [] })]
}

function buildTable(tableEl: Element): DocxTable {
	const rows = Array.from(tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')).map((tr) => {
		const cells = Array.from(tr.children)
			.filter((cell) => cell.tagName.toLowerCase() === 'td' || cell.tagName.toLowerCase() === 'th')
			.map((cell) => {
				const isHeader = cell.tagName.toLowerCase() === 'th'
				return new DocxTableCell({
					children: cellContent(cell, isHeader),
					verticalAlign: VerticalAlign.CENTER,
					margins: { top: 80, bottom: 80, left: 100, right: 100 },
				})
			})
		return new DocxTableRow({
			children: cells,
			tableHeader: tr.querySelector('th') !== null,
		})
	})
	return new DocxTable({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

/**
 * Convert an editor HTML string into a flat list of DOCX block nodes
 * (paragraphs and tables), preserving inline marks, nested list levels,
 * single-paragraph code blocks, tables, hyperlinks, and base64 images.
 *
 * `marks` is threaded into every inline run so callers can apply a base
 * style (e.g. bold header cells) to the whole subtree.
 */
export function buildDocxChildren(html: string, marks: RunMarks = {}): DocxBlock[] {
	const container = document.createElement('div')
	container.innerHTML = html
	const out: DocxBlock[] = []

	const buildBlocks = (parent: Element): void => {
		for (const el of Array.from(parent.children)) {
			const tag = el.tagName.toLowerCase()
			const alignment = alignmentFrom(el)

			if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
				out.push(new Paragraph({ children: buildRuns(el, marks), heading: HEADING_LEVELS[tag], alignment }))
			} else if (tag === 'p') {
				out.push(new Paragraph({ children: buildRuns(el, marks), spacing: BODY_SPACING, alignment }))
			} else if (tag === 'blockquote') {
				out.push(new Paragraph({
					children: buildRuns(el, marks),
					spacing: BODY_SPACING,
					indent: { left: 720 },
					border: { left: { style: 'single', size: 24, color: 'c9c9c9', space: 8 } },
				}))
			} else if (tag === 'pre') {
				const lines = (el.textContent || '').split('\n')
				const runs = lines.map((line, index) => new TextRun({ text: line, font: 'Courier New', break: index === 0 ? 0 : 1 }))
				out.push(new Paragraph({
					children: runs,
					spacing: CODE_SPACING,
					shading: { type: ShadingType.CLEAR, fill: 'f5f5f5' },
				}))
			} else if (tag === 'code') {
				out.push(new Paragraph({ children: buildRuns(el, { ...marks, font: 'Courier New' }), spacing: CODE_SPACING }))
			} else if (tag === 'ul' || tag === 'ol') {
				out.push(...buildList(el, tag === 'ol', 0, marks))
			} else if (tag === 'table') {
				out.push(buildTable(el))
			} else if (tag === 'hr') {
				out.push(new Paragraph({ children: [], spacing: { before: 120, after: 120 }, border: { bottom: { style: 'single', size: 6, color: 'bbbbbb' } } }))
			} else {
				// div / unknown wrapper — recurse into its children.
				buildBlocks(el)
			}
		}
	}

	buildBlocks(container)
	return out
}

export function buildDocxDocument(html: string, title: string): DocxDocument {
	const children = buildDocxChildren(html)
	return new DocxDocument({
		numbering: NUMBERING_CONFIG,
		sections: [
			{
				properties: {},
				children: children.length > 0 ? children : [new Paragraph({ children: [new TextRun(title || 'Document')] })],
			},
		],
	})
}

export async function exportToDocx(editorHtml: string, title: string): Promise<void> {
	try {
		const doc = buildDocxDocument(editorHtml, title)
		const blob = await Packer.toBlob(doc)
		downloadBlob(blob, `${slugifyTitle(title) || 'untitled'}.docx`)
	} catch (err) {
		console.error('Error generating DOCX export:', err)
		throw err
	}
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

export interface PdfPageLayoutOptions {
	pageWidth: number
	pageHeight: number
	margin: number
}

/** One printed page: the slice of the source canvas (pixels) and its
 * placement height in mm. Horizontal placement is always the page margin. */
export interface PdfPageSlice {
	cropY: number
	cropH: number
	height: number
}

/**
 * Slice a rendered page canvas into A4-sized slices with margins. The
 * epsilon guard and sub-pixel drop prevent the classic trailing empty page
 * when the canvas height isn't an exact multiple of the printable page
 * height.
 */
export function computePdfPageLayout(canvasWidth: number, canvasHeight: number, options: PdfPageLayoutOptions): PdfPageSlice[] {
	const { pageWidth, pageHeight, margin } = options
	const usableWidthMm = pageWidth - 2 * margin
	const usableHeightMm = pageHeight - 2 * margin
	const pxPerMm = canvasWidth / usableWidthMm
	const usablePxHeight = usableHeightMm * pxPerMm
	const totalPxHeight = canvasHeight
	const pageCount = Math.max(0, Math.ceil(totalPxHeight / usablePxHeight - 1e-6))

	const slices: PdfPageSlice[] = []
	for (let index = 0; index < pageCount; index++) {
		const cropY = index * usablePxHeight
		const cropH = Math.min(usablePxHeight, totalPxHeight - cropY)
		if (cropH < 1) {
			break
		}
		slices.push({ cropY, cropH, height: cropH / pxPerMm })
	}
	return slices
}

export async function exportToPdf(editorElement: HTMLElement, title: string): Promise<void> {
	try {
		const canvas = await html2canvas(editorElement, {
			scale: 2,
			useCORS: true,
			logging: false,
			backgroundColor: '#ffffff',
		})
		// Each page is sliced into its own canvas and emitted as a JPEG
		// (not lossless PNG) so the file stays small — a 4-page export was
		// ~54MB as PNG at scale 2; JPEG at 0.92 is a fraction of that.
		const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
		const { margin } = PDF_PAGE
		const usableWidthMm = PDF_PAGE.width - 2 * margin
		const slices = computePdfPageLayout(canvas.width, canvas.height, { pageWidth: PDF_PAGE.width, pageHeight: PDF_PAGE.height, margin })

		if (slices.length === 0) {
			pdf.addPage()
		}
		slices.forEach((slice, index) => {
			if (index > 0) {
				pdf.addPage()
			}
			// Slice each page into its own canvas so jsPDF gets a plain
			// image (its addImage crop overload is not in the public types).
			const pageCanvas = document.createElement('canvas')
			pageCanvas.width = canvas.width
			pageCanvas.height = slice.cropH
			const context = pageCanvas.getContext('2d')
			if (context) {
				context.drawImage(canvas, 0, slice.cropY, canvas.width, slice.cropH, 0, 0, canvas.width, slice.cropH)
				pdf.addImage(pageCanvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY), 'JPEG', margin, margin, usableWidthMm, slice.height)
			}
		})

		pdf.save(`${slugifyTitle(title) || 'untitled'}.pdf`)
	} catch (err) {
		console.error('Error generating PDF export:', err)
		throw err
	}
}