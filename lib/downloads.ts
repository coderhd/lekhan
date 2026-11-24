import type { Page } from './types'
import { exportPage } from './workspace'
import { makeWorkspaceArchive, safeFilename } from './workspace-export'
import { track } from './analytics'

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadPage(page: Page) {
  download(`${safeFilename(page.title)}.md`, new Blob([exportPage(page)], { type: 'text/markdown' }))
  track('export_triggered', 'markdown')
}

export async function downloadWorkspace(pages: Page[]) {
  const archive = await makeWorkspaceArchive(pages)
  download('Lekhan workspace.zip', new Blob([new Uint8Array(archive)], { type: 'application/zip' }))
  track('export_triggered', 'md_zip')
}
