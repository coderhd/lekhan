'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import {
	BROWSER_RESERVED_NOTE,
	SHORTCUT_GROUPS,
	detectShortcutPlatform,
	formatShortcut,
	type ShortcutItem,
} from '@/lib/shortcuts'

interface ShortcutHelpDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

function KeyChips ({ item, platform }: { item: ShortcutItem, platform: 'mac' | 'other' }) {
	if (item.keys) {
		const label = formatShortcut(item.keys, platform)
		return (
			<span className="flex flex-wrap items-center justify-end gap-1">
				<span className="sr-only">{label}</span>
				<span aria-hidden="true" className="flex flex-wrap items-center justify-end gap-1">
					{item.keys.map((key, idx) => (
						<kbd
							key={`${item.id}-${idx}`}
							className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-black/10 bg-surface-container-high px-1.5 py-0.5 font-mono text-[11px] font-semibold text-on-surface shadow-sm dark:border-white/15"
						>
							{platform === 'mac' ? key.mac : key.other}
						</kbd>
					))}
				</span>
			</span>
		)
	}

	if (item.gesture) {
		return (
			<code className="justify-self-end rounded-md border border-black/10 bg-surface-container-high px-2 py-0.5 font-mono text-[11px] font-semibold text-on-surface dark:border-white/15">
				{item.gesture}
			</code>
		)
	}

	return <span className="justify-self-end text-xs text-on-surface-variant">—</span>
}

export default function ShortcutHelpDialog ({ open, onOpenChange }: ShortcutHelpDialogProps) {
	const [platform, setPlatform] = useState<'mac' | 'other'>('other')

	// Platform only changes the key labels, so resolve it after mount instead of
	// risking a server/client mismatch in the first paint.
	useEffect(() => {
		setPlatform(detectShortcutPlatform())
	}, [])

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm animate-in fade-in" />
				<Dialog.Content
					aria-modal="true"
					className="fixed top-1/2 left-1/2 z-[100000] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-surface-container shadow-2xl animate-in zoom-in-95 dark:border-white/10"
				>
					<div className="flex items-start justify-between gap-sm border-b border-black/5 px-5 py-4 dark:border-white/5">
						<div>
							<Dialog.Title className="text-lg font-bold text-on-surface">
								Keyboard shortcuts
							</Dialog.Title>
							<Dialog.Description className="mt-1 text-sm text-on-surface-variant">
								Every shortcut Lekhan actually has. Nothing hidden, nothing promised.
							</Dialog.Description>
						</div>
						<Dialog.Close asChild>
							<button
								type="button"
								aria-label="Close keyboard shortcuts"
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10"
							>
								<span className="material-symbols-outlined text-lg" aria-hidden="true">close</span>
							</button>
						</Dialog.Close>
					</div>

					<div className="max-h-[68vh] overflow-y-auto px-5 py-4">
						{SHORTCUT_GROUPS.map(group => (
							<section key={group.id} className="mb-5 last:mb-0" aria-labelledby={`shortcut-group-${group.id}`}>
								<h3
									id={`shortcut-group-${group.id}`}
									className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant"
								>
									{group.title}
								</h3>
								<table className="w-full border-collapse text-sm">
									<caption className="sr-only">{group.title} shortcuts</caption>
									<tbody>
										{group.items.map(item => (
											<tr key={item.id} className="align-top">
												<td className="w-[56%] py-2 pr-4 text-on-surface">
													<span className="font-medium">{item.label}</span>
													{item.description && (
														<span className="mt-0.5 block text-xs leading-snug text-on-surface-variant">
															{item.description}
														</span>
													)}
													{item.note && (
														<span className="mt-0.5 block text-xs font-medium text-primary">
															{item.note}
														</span>
													)}
												</td>
												<td className="w-[44%] py-2 text-right">
													<KeyChips item={item} platform={platform} />
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</section>
						))}
					</div>

					<p className="border-t border-black/5 px-5 py-3 text-xs text-on-surface-variant dark:border-white/5">
						{BROWSER_RESERVED_NOTE}
					</p>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
