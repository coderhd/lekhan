import htmlToDocx from 'html-to-docx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function exportToDocx(editorHtml: string, title: string): Promise<void> {
	try {
		const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title || 'Document'}</title></head><body>${editorHtml}</body></html>`
		const fileBuffer = await htmlToDocx(fullHtml, null, {
			title: title || 'Document',
			margin: { top: 720, right: 720, bottom: 720, left: 720 },
		})
		const blob = fileBuffer instanceof Blob
			? fileBuffer
			: new Blob([new Uint8Array(fileBuffer as unknown as ArrayBuffer)], {
				type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			})
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
