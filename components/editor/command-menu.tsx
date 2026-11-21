import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

export interface CommandItem {
  id: string
  title: string
  description?: string
  icon: LucideIcon
}

interface CommandMenuProps {
  id: string
  title: string
  items: CommandItem[]
  active: number
  left: number
  top: number
  above: boolean
  select: (item: CommandItem) => void
}

export function CommandMenu({ id, title, items, active, left, top, above, select }: CommandMenuProps) {
  const selected = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const activeId = items[active]?.id

  useEffect(() => {
    const option = selected.current?.getBoundingClientRect()
    const edges = list.current?.getBoundingClientRect()
    if (!option || !edges) return
    if (option.top < edges.top) list.current?.scrollBy({ top: option.top - edges.top })
    if (option.bottom > edges.bottom) list.current?.scrollBy({ top: option.bottom - edges.bottom })
  }, [active, activeId])

  return createPortal(
    <div
      className="writer-command-menu"
      data-writer-command-menu={id}
      data-above={above}
      style={{ left, top }}
    >
      <div className="writer-command-header">
        <span>{title}</span>
        <kbd>Esc</kbd>
      </div>
      <div className="writer-command-items" id={id} ref={list} role="listbox" aria-label={title}>
        {items.map((item, index) => {
          const { id: key, title: label, description, icon: Icon } = item
          return (
            <button
              key={key}
              ref={index === active ? selected : undefined}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              type="button"
              className="writer-command-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(item)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                {description && <small>{description}</small>}
              </span>
              {index === active && <kbd aria-hidden="true">↵</kbd>}
            </button>
          )
        })}
      </div>
      {items.length === 0 && <div className="writer-command-empty" role="status">No matching commands</div>}
    </div>,
    document.body,
  )
}
