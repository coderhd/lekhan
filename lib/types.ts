import type { ImportReport } from './vault-import'

export interface Page {
  id: string
  parentId: string | null
  title: string
  markdown: string
  frontmatter?: string
  properties?: Record<string, unknown>
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  revision: number
  pages: Page[]
  activePageId: string | null
  vaultImports?: Record<string, { report: ImportReport; firstPageId: string }>
}

export interface PageChoice {
  id: string
  title: string
  path: string
}
