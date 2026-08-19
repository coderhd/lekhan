import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Document as DocxDocument, Packer, Paragraph, Table as DocxTable } from 'docx'
import { buildDocxChildren, buildDocxDocument, computePdfPageLayout, NUMBERING_CONFIG } from '@/lib/export-utils'

const A4 = { pageWidth: 210, pageHeight: 297 }
const MARGIN = 12
// 1860px wide canvas at 10px/mm -> usableW 186mm; usableH 273mm -> 2730px
const CANVAS_W = 1860
const USABLE_PX_H = 2730

async function documentXml(children: (Paragraph | DocxTable)[]): Promise<{ xml: string; rels: string }> {
	const doc = new DocxDocument({
		numbering: NUMBERING_CONFIG,
		sections: [{ properties: {}, children }],
	})
	const buffer = await Packer.toBuffer(doc)
	const zip = await JSZip.loadAsync(buffer)
	const xml = await zip.file('word/document.xml')!.async('string')
	const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
	return { xml, rels }
}

describe('computePdfPageLayout', () => {
	it('produces one page when content fits exactly within the margins', () => {
		const crops = computePdfPageLayout(CANVAS_W, USABLE_PX_H, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(1)
		expect(crops[0]).toEqual({ cropY: 0, cropH: 2730, height: 273 })
	})

	it('adds a page for every full page of content', () => {
		const crops = computePdfPageLayout(CANVAS_W, USABLE_PX_H * 4, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(4)
		expect(crops[1].cropY).toBe(USABLE_PX_H)
		expect(crops[3].cropY).toBe(USABLE_PX_H * 3)
	})

	it('sizes each page to the content remaining on the final page', () => {
		const crops = computePdfPageLayout(CANVAS_W, USABLE_PX_H * 2 + 540, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(3)
		expect(crops[2].height).toBe(54)
		expect(crops[2].cropH).toBe(540)
	})

	it('does not emit a trailing page for a sub-pixel rounding sliver', () => {
		const crops = computePdfPageLayout(CANVAS_W, USABLE_PX_H * 2 + 0.0001, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(2)
	})

	it('drops a final page that would contain less than one pixel of content', () => {
		const crops = computePdfPageLayout(CANVAS_W, USABLE_PX_H * 2 + 0.5, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(2)
	})

	it('covers the whole canvas across pages without gaps or overlaps', () => {
		const canvasHeight = USABLE_PX_H * 2 + 540
		const crops = computePdfPageLayout(CANVAS_W, canvasHeight, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(3)
		expect(crops[0].cropY).toBe(0)
		expect(crops[1].cropY).toBe(USABLE_PX_H)
		expect(crops[2].cropY).toBe(USABLE_PX_H * 2)
		expect(crops.reduce((sum, crop) => sum + crop.cropH, 0)).toBe(canvasHeight)
	})

	it('returns no pages for an empty canvas', () => {
		const crops = computePdfPageLayout(CANVAS_W, 0, { ...A4, margin: MARGIN })
		expect(crops).toHaveLength(0)
	})
})

describe('buildDocxChildren — structure-preserving conversion', () => {
	it('maps headings to Word heading styles', async () => {
		const { xml } = await documentXml(buildDocxChildren('<h1>One</h1><h2>Two</h2><h3>Three</h3>'))
		expect(xml).toContain('Heading1')
		expect(xml).toContain('Heading2')
		expect(xml).toContain('Heading3')
	})

	it('preserves inline bold, italic, underline, and strike', async () => {
		const { xml } = await documentXml(buildDocxChildren('<p><strong>bold</strong> <em>italic</em> <u>under</u> <s>gone</s> plain</p>'))
		expect(xml).toContain('<w:b')
		expect(xml).toContain('<w:i')
		expect(xml).toContain('<w:u')
		expect(xml).toContain('<w:strike')
	})

	it('renders inline code in a monospace font', async () => {
		const { xml } = await documentXml(buildDocxChildren('<p>run <code>const x = 1</code> here</p>'))
		expect(xml).toContain('Courier New')
	})

	it('turns hyperlinks into Word hyperlinks with a target relationship', async () => {
		const { xml, rels } = await documentXml(buildDocxChildren('<p>see <a href="https://example.com">the docs</a></p>'))
		expect(xml).toContain('<w:hyperlink')
		expect(rels).toContain('https://example.com')
	})

	it('nests list items with increasing levels', async () => {
		const html = '<ul><li>one<ul><li>one.one<ul><li>one.one.one</li></ul></li></ul></li><li>two</li></ul>'
		const { xml } = await documentXml(buildDocxChildren(html))
		expect(xml).toContain('<w:ilvl w:val="0"')
		expect(xml).toContain('<w:ilvl w:val="1"')
		expect(xml).toContain('<w:ilvl w:val="2"')
	})

	it('keeps a code block as a single paragraph with line breaks', async () => {
		const { xml } = await documentXml(buildDocxChildren('<pre>line one\nline two\nline three</pre>'))
		const paragraphCount = (xml.match(/<w:p[ >]/g) || []).length
		expect(paragraphCount).toBe(1)
		expect(xml).toContain('<w:br/>')
	})

	it('builds tables with cells and keeps a header cell bold', async () => {
		const html = '<table><tr><th>Head</th><td>Cell</td></tr></table>'
		const { xml } = await documentXml(buildDocxChildren(html))
		expect(xml).toContain('<w:tbl>')
		expect(xml).toContain('<w:tc>')
		expect(xml).toContain('<w:t xml:space="preserve">Head</w:t>')
		expect(xml).toContain('<w:t xml:space="preserve">Cell</w:t>')
		expect(xml).toContain('<w:tblHeader/>')
	})

	it('bolds a header cell even when it contains block content', async () => {
		const html = '<table><tr><th><p>Head</p></th><td><p>Cell</p></td></tr></table>'
		const { xml } = await documentXml(buildDocxChildren(html))
		expect(xml).toContain('<w:t xml:space="preserve">Head</w:t>')
		expect(xml).toContain('<w:b')
		expect(xml).toContain('<w:t xml:space="preserve">Cell</w:t>')
	})

	it('handles a top-level code element instead of dropping it', async () => {
		const { xml } = await documentXml(buildDocxChildren('<code>const x = 1</code>'))
		expect(xml).toContain('Courier New')
		expect(xml).toContain('<w:t xml:space="preserve">const x = 1</w:t>')
	})

	it('caps list nesting at the deepest numbering level', async () => {
		const deep = Array.from({ length: 7 }, (_, i) => `<li>level ${i}<ul>`).join('') + 'bottom' + '</ul>'.repeat(7)
		const { xml } = await documentXml(buildDocxChildren(`<ul>${deep}</ul>`))
		expect(xml).toContain('<w:ilvl w:val="4"')
		expect(xml).not.toContain('<w:ilvl w:val="5"')
	})

	it('embeds base64 images as drawing elements', async () => {
		const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
		const { xml } = await documentXml(buildDocxChildren(`<p><img src="data:image/png;base64,${tinyPng}" width="50" height="40"/></p>`))
		expect(xml).toContain('<w:drawing>')
	})

	it('falls back to the title paragraph for empty content', async () => {
		const doc = buildDocxDocument('', 'My Title')
		const buffer = await Packer.toBuffer(doc)
		const zip = await JSZip.loadAsync(buffer)
		const xml = await zip.file('word/document.xml')!.async('string')
		expect(xml).toContain('<w:t xml:space="preserve">My Title</w:t>')
	})
})
