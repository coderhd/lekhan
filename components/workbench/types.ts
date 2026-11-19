import type { ReactNode } from 'react'

export interface WorkbenchPageLink {
	id: string
	title: string
}

/** Presentation only: callers retain data, permission and action ownership. */
export interface WorkbenchShellProps {
	active: 'workspace' | 'editor' | 'graph' | 'settings'
	workspaceName: string
	pages?: readonly WorkbenchPageLink[]
	currentPageId?: string
	onSearch: () => void
	onBrowse?: () => void
	onCapture?: () => void
	onImport?: () => void
	onExport?: () => void
	headerActions?: ReactNode
	children: ReactNode
}
