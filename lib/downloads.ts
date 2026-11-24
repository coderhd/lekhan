import { attachmentReference } from './local-attachments'
import { mapMarkdownDestinations } from './markdown-destinations'
import type { LocalAttachment, Page } from './types'
import { exportPage } from './workspace'
import { makeWorkspaceArchive, markdownArchivePath, safeAttachmentFilename, safeFilename } from './workspace-export'
import { track } from './analytics'

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadAttachment(file: LocalAttachment) {
  const data = new Blob([new Uint8Array(file.data)], { type: 'application/octet-stream' })
  downloadBlob(safeAttachmentFilename(file.filename), data)
}

export function downloadPage(page: Page) {
  const files = page.files
  const markdown = files?.length ? mapMarkdownDestinations(page.markdown, target => {
    const link = attachmentReference(target)
    const file = link && files.find(item => item.id === link.id)
    if (file && link) return markdownArchivePath(safeAttachmentFilename(file.filename)) + encodeURI(link.fragment).replace(/[()]/g, char => char === '(' ? '%28' : '%29')
  }) : page.markdown
  downloadBlob(`${safeFilename(page.title)}.md`, new Blob([exportPage({ ...page, markdown })], { type: 'text/markdown' }))
  track('export_triggered', 'markdown')
}

export async function downloadWorkspace(pages: Page[]) {
  const archive = await makeWorkspaceArchive(pages)
  downloadBlob('Lekhan workspace.zip', new Blob([new Uint8Array(archive)], { type: 'application/zip' }))
  track('export_triggered', 'md_zip')
}
