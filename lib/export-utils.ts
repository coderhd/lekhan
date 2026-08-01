import { Document as DocxDocument, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function exportToDocx(editorHtml: string, title: string): Promise<void> {
	try {
		const tempDiv = document.createElement('div')
		tempDiv.innerHTML = editorHtml
		const elements = Array.from(tempDiv.children)

		const docxParagraphs: Paragraph[] = []

		if (elements.length === 0 && tempDiv.textContent) {
			docxParagraphs.push(new Paragraph({ children: [new TextRun(tempDiv.textContent)] }))
		} else {
			elements.forEach((el) => {
				const text = el.textContent || ''
				const tagName = el.tagName.toLowerCase()

				if (tagName === 'h1') {
					docxParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_1 }))
				} else if (tagName === 'h2') {
					docxParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_2 }))
				} else if (tagName === 'h3') {
					docxParagraphs.push(new Paragraph({ text, heading: HeadingLevel.HEADING_3 }))
				} else if (tagName === 'ul' || tagName === 'ol') {
					const items = Array.from(el.querySelectorAll('li'))
					items.forEach((item) => {
						docxParagraphs.push(new Paragraph({ text: item.textContent || '', bullet: { level: 0 } }))
					})
				} else {
					docxParagraphs.push(new Paragraph({ children: [new TextRun(text)] }))
				}
			})
		}

		const doc = new DocxDocument({
			sections: [
				{
					properties: {},
					children: docxParagraphs.length > 0 ? docxParagraphs : [new Paragraph({ text: title || 'Document' })],
				},
			],
		})

		const blob = await Packer.toBlob(doc)
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = `${(title || 'document').replace(/\s+/g, '_')}.docx`
		document.body.appendChild(link)
		link.click()
		document.body.removeChild(link)
		URL.revokeObjectURL(url)
	} catch (err) {
		console.error('Error generating DOCX export:', err)
		throw err
	}
}

export async function exportToPdf(editorElement: HTMLElement, title: string): Promise<void> {
	try {
		const canvas = await html2canvas(editorElement, {
			scale: 2,
			useCORS: true,
			logging: false,
			backgroundColor: '#ffffff',
		})
		const imgData = canvas.toDataURL('image/png')
		const pdf = new jsPDF({
			orientation: 'portrait',
			unit: 'mm',
			format: 'a4',
		})
		const imgWidth = 210
		const pageHeight = 297
		const imgHeight = (canvas.height * imgWidth) / canvas.width
		let heightLeft = imgHeight
		let position = 0

		pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
		heightLeft -= pageHeight

		while (heightLeft >= 0) {
			position = heightLeft - imgHeight
			pdf.addPage()
			pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
			heightLeft -= pageHeight
		}

		pdf.save(`${(title || 'document').replace(/\s+/g, '_')}.pdf`)
	} catch (err) {
		console.error('Error generating PDF export:', err)
		throw err
	}
}
