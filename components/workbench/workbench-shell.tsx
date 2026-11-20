'use client'
import { useOpenSettings } from '@/components/settings/settings-provider'
import { Button as AstryxButton } from '@astryxdesign/core/Button'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
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
	onBrowse,
	onCapture,
	onImport,
	onExport,
	headerActions,
	children
}: WorkbenchShellProps) {
	const openSettings = useOpenSettings()
	const [navigationOpen, setNavigationOpen] = useState(false)
	const pendingAction = useRef<(() => void) | null>(null)
	const navigationTrigger = useRef<HTMLButtonElement>(null)
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
				{mobile && onBrowse && (
					<button type="button" onClick={() => runAction(onBrowse, mobile)}>Browse workspace pages</button>
				)}
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
				<button type="button" aria-haspopup="dialog" onClick={event => {
					const trigger = mobile ? navigationTrigger.current : event.currentTarget
					runAction(() => openSettings('profile', trigger), mobile)
				}}>
					<Settings aria-hidden="true" />
					Settings
				</button>
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
								ref={navigationTrigger}
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
										// Palettes remember the focused element as their return target.
										// The menu item has unmounted, so focus its persistent trigger first.
										navigationTrigger.current?.focus()
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
						<Image src="/logo.png" alt="" width={24} height={24} />
						Lekhan
					</Link>
					<span className="wb-breadcrumb">
						/ {workspaceName}
						{active === 'editor' ? ' / Pages' : ''}
					</span>
				</div>
				<div className="wb-topbar-actions">
					<AstryxButton label="Search pages" variant="ghost" isIconOnly
						className="wb-header-search ax-touch" tooltip="Search (⌘ K)"
						icon={<Search aria-hidden="true" />} onClick={onSearch} />
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
