'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import {
	SHORTCUT_GROUPS,
	browserReservedNote,
	detectShortcutPlatform,
	formatShortcut,
	type ShortcutItem,
} from '@/lib/shortcuts'

interface ShortcutHelpDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/**
	 * Where focus should return when the sheet closes. The palette handoff
	 * unmounts the footer button that opened help, so the caller passes the
	 * element that was focused before the palette opened.
	 */
	returnFocusTo?: HTMLElement | null
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

	return (
		<span className="justify-self-end text-xs text-on-surface-variant">
			<span className="sr-only">No shortcut</span>
			<span aria-hidden="true">—</span>
		</span>
	)
}

export default function ShortcutHelpDialog ({ open, onOpenChange, returnFocusTo = null }: ShortcutHelpDialogProps) {
	const [platform, setPlatform] = useState<'mac' | 'other'>('other')
	const openerRef = useRef<HTMLElement | null>(null)

	// Platform only changes the key labels, so resolve it after mount instead of
	// risking a server/client mismatch in the first paint. Also remember what
	// had focus so closing the sheet returns the user where they were — Radix
	// cannot do that on its own when the sheet is opened programmatically.
	useEffect(() => {
		if (open) {
			openerRef.current = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
			setPlatform(detectShortcutPlatform())
			return
		}
		// A palette/help handoff opens the replacement modal in the same commit;
		// that modal owns focus, so do not steal it back here.
		const anotherModalIsOpen = document.querySelector('[role="dialog"][data-state="open"]') !== null
		if (!anotherModalIsOpen && openerRef.current?.isConnected) {
			openerRef.current.focus()
		}
		openerRef.current = null
	}, [open, returnFocusTo])

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm animate-in fade-in" />
				<Dialog.Content
					aria-modal="true"
					data-modal="shortcut-help"
					className="fixed top-1/2 left-1/2 z-[100000] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/10 bg-surface-container shadow-2xl animate-in zoom-in-95 dark:border-white/10"
				>
					<div className="flex items-start justify-between gap-sm border-b border-black/5 px-5 py-4 dark:border-white/5">
						<div>
							<Dialog.Title className="text-lg font-bold text-on-surface">
								Keyboard shortcuts
							</Dialog.Title>
							<Dialog.Description className="mt-1 text-sm text-on-surface-variant">
								The gestures this build actually implements — nothing hidden, nothing promised.
							</Dialog.Description>
						</div>
						<Dialog.Close asChild>
							<button
								type="button"
								aria-label="Close keyboard shortcuts"
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10"
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
						{browserReservedNote(platform)}
					</p>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
