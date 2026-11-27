import type { ImportReport } from './vault-import'
import type { PendingLocalMirror } from './cloud/local-mirror'

export interface LocalAttachment {
  id: string
  filename: string
  data: Uint8Array
}

export interface Page {
  id: string
  parentId: string | null
  title: string
  markdown: string
  folder?: boolean
  frontmatter?: string
  properties?: Record<string, unknown>
  files?: LocalAttachment[]
  favorite: boolean
  createdAt: string
  updatedAt: string
  cloudMirror?: PendingLocalMirror | { state: 'linked'; pageId: string }
}

export interface Workspace {
  revision: number
  pages: Page[]
  activePageId: string | null
  mirrorNotebookId?: string
  vaultImports?: Record<string, { report: ImportReport; firstPageId: string }>
}

export interface PageChoice {
  id: string
  title: string
  path: string
}
