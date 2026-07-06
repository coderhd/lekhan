import { useEffect, useState, useRef } from 'react'
import { Editor } from '@tiptap/react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

export function DragContextMenu({ editor }: { editor: Editor | null }) {
	const [handlePos, setHandlePos] = useState<{ top: number; left: number } | null>(null)
	const [hoveredNodePos, setHoveredNodePos] = useState<number | null>(null)
	const handleRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!editor) return

		const onMouseMove = (e: MouseEvent) => {
			const view = editor.view
			const dom = view.dom
			if (!dom) return

			// Don't update if menu is open (we can't easily track Radix state here without props, 
			// but we'll assume standard behavior. If the user moves mouse far away, we hide it)
			const rect = dom.getBoundingClientRect()
			
			// Try to find the ProseMirror node at the current mouse coordinates
			const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })
			if (!pos) {
				// Hide if outside editor bounds roughly
				if (e.clientX < rect.left - 40 || e.clientX > rect.right + 40 || e.clientY < rect.top - 40 || e.clientY > rect.bottom + 40) {
					setHandlePos(null)
					setHoveredNodePos(null)
				}
				return
			}

			let nodePos = pos.pos
			let node = view.state.doc.resolve(nodePos)

			// Find the closest block node
			while (node.depth > 0) {
				if (node.parent.type.isBlock && !node.parent.type.isTextblock) {
					// Found a block container (like a list or doc)
					break
				}
				nodePos = node.before()
				node = view.state.doc.resolve(nodePos)
			}
			
			// Let's use DOM to find the block element instead, it's visually more accurate
			const target = e.target as HTMLElement
			const blockElement = target.closest('.ProseMirror > *') as HTMLElement
			
			if (blockElement) {
				const editorCanvas = blockElement.closest('.editor-canvas') as HTMLElement
				if (editorCanvas) {
					const blockRect = blockElement.getBoundingClientRect()
					const canvasRect = editorCanvas.getBoundingClientRect()
					setHandlePos({
						top: blockRect.top - canvasRect.top,
						left: blockRect.left - canvasRect.left - 30,
					})
				}
				
				// Try to get pos from DOM
				const pmPos = view.posAtDOM(blockElement, 0)
				if (pmPos >= 0) {
					setHoveredNodePos(pmPos)
				}
			} else {
				// Hide if mouse moved to empty space
				setHandlePos(null)
			}
		}

		window.addEventListener('mousemove', onMouseMove)
		return () => {
			window.removeEventListener('mousemove', onMouseMove)
		}
	}, [editor])

	if (!handlePos || hoveredNodePos === null || !editor) return null

	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<div
					ref={handleRef}
					className="absolute z-50 cursor-grab hover:bg-black/5 dark:hover:bg-white/10 rounded p-0.5 text-on-surface-variant flex items-center justify-center transition-colors"
					style={{ top: handlePos.top, left: handlePos.left }}
					title="Click to open menu"
				>
					<span className="material-symbols-outlined text-[16px]">drag_indicator</span>
				</div>
			</DropdownMenu.Trigger>

			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className="z-[9999] min-w-[8rem] bg-surface-container rounded-xl border border-black/10 dark:border-white/10 p-1 shadow-xl"
					sideOffset={5}
					align="start"
				>
					<DropdownMenu.Item
						onClick={() => {
							const { state, view } = editor
							const tr = state.tr
							const node = state.doc.nodeAt(hoveredNodePos)
							if (node) {
								tr.delete(hoveredNodePos, hoveredNodePos + node.nodeSize)
								view.dispatch(tr)
							}
						}}
						className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-500/10 cursor-pointer outline-none"
					>
						<span className="material-symbols-outlined text-[16px]">delete</span>
						<span>Delete</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						onClick={() => {
							const { state, view } = editor
							const tr = state.tr
							const node = state.doc.nodeAt(hoveredNodePos)
							if (node) {
								tr.insert(hoveredNodePos + node.nodeSize, node)
								view.dispatch(tr)
							}
						}}
						className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-on-surface hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer outline-none"
					>
						<span className="material-symbols-outlined text-[16px]">content_copy</span>
						<span>Duplicate</span>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	)
}
