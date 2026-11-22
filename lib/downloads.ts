import { strToU8, zipSync } from 'fflate'
import type { Page } from './types'
import { exportPage, pagePath } from './workspace'
import { track } from './analytics'

function safeFilename(name: string) {
  const sanitized = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100)
  return sanitized || 'Untitled'
}

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

export function downloadWorkspace(pages: Page[]) {
  const files: Record<string, Uint8Array> = {}
  for (const page of pages) {
    const parts = pagePath(pages, page.id).map(item => safeFilename(item.title))
    const basePath = parts.join('/')
    let path = `${basePath}.md`
    let suffix = 2
    while (Object.hasOwn(files, path)) {
      path = `${basePath} (${suffix}).md`
      suffix += 1
    }
    files[path] = strToU8(exportPage(page))
  }
  const archive = zipSync(files)
  download('Lekhan workspace.zip', new Blob([new Uint8Array(archive)], { type: 'application/zip' }))
  track('export_triggered', 'md_zip')
}
