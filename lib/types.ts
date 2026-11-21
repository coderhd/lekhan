export interface Page {
  id: string
  parentId: string | null
  title: string
  markdown: string
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  revision: number
  pages: Page[]
  activePageId: string | null
}

export interface PageChoice {
  id: string
  title: string
  path: string
}
