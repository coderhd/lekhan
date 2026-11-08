'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import {
	FileText,
	Home,
	Menu,
	Network,
	Plus,
	Search,
	Settings,
	Upload,
	Download,
	X
} from 'lucide-react'
import { useGlobalHeaderSlots } from '@/components/layout/global-header-context'
import type { WorkbenchShellProps } from './types'

export default function WorkbenchShell({
	active,
	workspaceName,
	pages = [],
	currentPageId,
	onSearch,
	onCapture,
	onImport,
	onExport,
	headerActions,
	children
}: WorkbenchShellProps) {
	const [navigationOpen, setNavigationOpen] = useState(false)
	const pendingAction = useRef<(() => void) | null>(null)
	const { registerWorkbenchChrome } = useGlobalHeaderSlots()
	useEffect(() => registerWorkbenchChrome(), [registerWorkbenchChrome])

	const runAction = (action: () => void, mobile: boolean) => {
		if (mobile) {
			pendingAction.current = action
			setNavigationOpen(false)
		} else action()
	}
	const navigation = (mobile: boolean) => (
		<>
			<div className="wb-workspace-name">
				<span className="wb-workspace-avatar" aria-hidden="true">
					{workspaceName.slice(0, 1)}
				</span>
				<span>{workspaceName}</span>
			</div>
			<nav className="wb-nav" aria-label="Main navigation">
				<Link
					href="/"
					aria-current={active === 'workspace' ? 'page' : undefined}
					onClick={() => setNavigationOpen(false)}
				>
					<Home aria-hidden="true" />
					Workspace
				</Link>
				<button type="button" onClick={() => runAction(onSearch, mobile)}>
					<Search aria-hidden="true" />
					Search
				</button>
				<Link
					href="/graph"
					aria-current={active === 'graph' ? 'page' : undefined}
					onClick={() => setNavigationOpen(false)}
				>
					<Network aria-hidden="true" />
					Graph
				</Link>
				<Link
					href="/settings"
					aria-current={active === 'settings' ? 'page' : undefined}
					onClick={() => setNavigationOpen(false)}
				>
					<Settings aria-hidden="true" />
					Settings
				</Link>
			</nav>
			{pages.length > 0 && (
				<nav className="wb-pages" aria-label="Pages">
					<p>Pages</p>
					{pages.map((page) => (
						<Link
							key={page.id}
							href={`/page/${page.id}`}
							aria-current={page.id === currentPageId ? 'page' : undefined}
							onClick={() => setNavigationOpen(false)}
						>
							<FileText aria-hidden="true" />
							<span>{page.title}</span>
						</Link>
					))}
				</nav>
			)}
			{(onCapture || onImport || onExport) && (
				<div className="wb-rail-actions">
					{onCapture && (
						<button type="button" onClick={() => runAction(onCapture, mobile)}>
							<Plus aria-hidden="true" />
							Quick capture
						</button>
					)}
					{onImport && (
						<button type="button" onClick={() => runAction(onImport, mobile)}>
							<Upload aria-hidden="true" />
							Import pages
						</button>
					)}
					{onExport && (
						<button type="button" onClick={() => runAction(onExport, mobile)}>
							<Download aria-hidden="true" />
							Export workspace
						</button>
					)}
				</div>
			)}
		</>
	)

	return (
		<div className="workbench-shell">
			<header className="wb-topbar">
				<div className="wb-topbar-start">
					<Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
						<Dialog.Trigger asChild>
							<button
								type="button"
								className="wb-icon-button wb-mobile-navigation"
								aria-label="Open workspace navigation"
							>
								<Menu aria-hidden="true" />
							</button>
						</Dialog.Trigger>
						<Dialog.Portal>
							<Dialog.Overlay className="wb-scrim" />
							<Dialog.Content
								className="wb-navigation-dialog"
								onCloseAutoFocus={(event) => {
									if (pendingAction.current) {
										event.preventDefault()
										const action = pendingAction.current
										pendingAction.current = null
										action()
									}
								}}
							>
								<div className="wb-dialog-heading">
									<Dialog.Title>Workspace navigation</Dialog.Title>
									<Dialog.Close asChild>
										<button
											type="button"
											className="wb-icon-button"
											aria-label="Close workspace navigation"
										>
											<X aria-hidden="true" />
										</button>
									</Dialog.Close>
								</div>
								<Dialog.Description className="sr-only">
									Navigate your workspace, pages and tools.
								</Dialog.Description>
								{navigation(true)}
							</Dialog.Content>
						</Dialog.Portal>
					</Dialog.Root>
					<Link className="wb-logo" href="/">
						Lekhan
					</Link>
					<span className="wb-breadcrumb">
						/ {workspaceName}
						{active === 'editor' ? ' / Pages' : ''}
					</span>
				</div>
				<div className="wb-topbar-actions">
					<button
						type="button"
						className="wb-icon-button wb-header-search"
						aria-label="Search pages"
						title="Search (Cmd+K)"
						onClick={onSearch}
					>
						<Search aria-hidden="true" />
						<kbd>⌘ K</kbd>
					</button>
					{headerActions}
				</div>
			</header>
			<div className="wb-body">
				<aside className="wb-sidebar" aria-label="Workspace navigation">
					{navigation(false)}
				</aside>
				<div className="wb-content">{children}</div>
			</div>
		</div>
	)
}
