'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CornerDownLeft, FileText, Search, X } from 'lucide-react'
import type { Page } from '@/lib/types'
import { pagePath, searchPages } from '@/lib/workspace'

export function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`overlay-dialog ${className}`}
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog-content">{children}</div>
    </dialog>
  )
}

export function SearchDialog({
  pages,
  onOpen,
  onClose,
}: {
  pages: Page[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const results = searchPages(pages, query).slice(0, 30)
  const selected = Math.min(highlight, results.length - 1)
  const row = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <Dialog title="Search pages" onClose={onClose} className="search-dialog">
      <div className="search-input-row">
        <Search size={19} aria-hidden="true" />
        <input
          autoFocus
          type="search"
          aria-label="Search pages"
          placeholder="Find a page or a phrase…"
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || results.length === 0) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const offset = event.key === 'ArrowDown' ? 1 : -1
              setHighlight((selected + offset + results.length) % results.length)
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onOpen(results[selected].id)
            }
          }}
        />
        <button type="button" className="icon-button" aria-label="Close search" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="search-results">
        <p className="section-label">{query.trim() ? 'Results' : 'Recent pages'}</p>
        {results.map((page, index) => {
          const ancestors = pagePath(pages, page.id).slice(0, -1)
          return (
            <button
              key={page.id}
              ref={index === selected ? row : undefined}
              className="search-result"
              data-selected={index === selected}
              onPointerMove={() => setHighlight(index)}
              onClick={() => onOpen(page.id)}
            >
              <FileText size={17} aria-hidden="true" />
              <span>
                <strong>{page.title}</strong>
                {ancestors.length > 0 && <small>{ancestors.map(item => item.title).join(' / ')}</small>}
              </span>
              {index === selected && <CornerDownLeft className="search-enter" size={16} aria-hidden="true" />}
            </button>
          )
        })}
        {results.length === 0 && <p className="dialog-empty">No pages found.</p>}
      </div>
      <div className="search-help">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>esc</kbd> Close</span>
      </div>
    </Dialog>
  )
}
