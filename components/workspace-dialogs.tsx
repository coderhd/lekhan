'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CornerDownLeft, FileText, Search, X } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import type { Page } from '@/lib/types'
import { pagePath } from '@/lib/workspace'
import { workspaceSearch } from '@/lib/workspace-search'
import type { CloudSearchResult } from '@/lib/cloud/search'

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
  initialQuery = '',
  onOpen,
  onOpenCloud,
  onClose,
}: {
  pages?: Page[]
  initialQuery?: string
  onOpen?: (id: string) => void
  onOpenCloud?: (id: string) => void
  onClose: () => void
}) {
  const t = useTranslations('app-shell')
  const resultsId = useId()
  const [query, setQuery] = useState(initialQuery)
  const [highlight, setHighlight] = useState(0)
  const [cloud, setCloud] = useState(!pages)
  const [remote, setRemote] = useState<{ query: string; pages: CloudSearchResult[] | null }>()
  const term = query.trim()
  const input = useRef<HTMLInputElement>(null)
  const row = useRef<HTMLButtonElement>(null)
  const loading = cloud && remote?.query !== term
  const failed = cloud && !loading && remote?.pages === null
  const results = cloud ? loading ? [] : remote?.pages ?? []
    : pages ? workspaceSearch(pages).query(query, term ? 15 : 8).map(({ page, context }) => ({
      id: page.id, title: page.title, context,
    })) : []
  const selected = Math.min(highlight, results.length - 1)
  const open = cloud ? onOpenCloud : onOpen

  useEffect(() => {
    if (!cloud) return
    const request = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const reply = await fetch('/api/search?' + new URLSearchParams({ q: term }), {
          cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        })
        if (!reply.ok) throw new Error('Search failed.')
        const { pages }: { pages: CloudSearchResult[] } = await reply.json()
        if (!request.signal.aborted) setRemote({ query: term, pages })
      } catch {
        if (!request.signal.aborted) setRemote({ query: term, pages: null })
      }
    }, term ? 100 : 0)
    return () => {
      clearTimeout(timer)
      request.abort()
    }
  }, [term, cloud])

  useEffect(() => {
    row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <Dialog title={t('searchPages')} onClose={onClose} className="search-dialog">
      <div className="search-input-row">
        <Search size={19} aria-hidden="true" />
        <input
          ref={input}
          autoFocus
          type="search"
          role="combobox"
          aria-label={t('searchPages')}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={selected >= 0 ? `${resultsId}-${results[selected].id}` : undefined}
          placeholder={t('findPageOrPhrase')}
          maxLength={cloud ? 160 : undefined}
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
              open?.(results[selected].id)
            }
          }}
        />
        <button type="button" className="icon-button" aria-label={t('closeSearch')} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      {pages && onOpenCloud && <div className="search-scope" role="group" aria-label={t('searchPages')}>
        {[false, true].map(value => <button
          type="button" key={String(value)} aria-pressed={cloud === value}
          onClick={() => {
            setCloud(value)
            if (value) setQuery(query.slice(0, 160))
            setHighlight(0)
            input.current?.focus()
          }}
        >{t(value ? 'searchCloud' : 'searchLocal')}</button>)}
      </div>}
      <div className="search-results">
        <p className="section-label">{query.trim() ? t('results') : t('recentPages')}</p>
        <div id={resultsId} role="listbox" aria-label={t('matchingPages')} aria-busy={loading}>
        {results.map(({ id, title, context }, index) => {
          const ancestors = !cloud && pages ? pagePath(pages, id).slice(0, -1) : []
          return (
            <button
              key={id}
              ref={index === selected ? row : undefined}
              id={`${resultsId}-${id}`}
              className="search-result"
              role="option"
              tabIndex={-1}
              aria-selected={index === selected}
              data-selected={index === selected}
              onPointerMove={() => setHighlight(index)}
              onClick={() => open?.(id)}
            >
              <FileText size={17} aria-hidden="true" />
              <span>
                <strong>{title}</strong>
                {context && <small>{context}</small>}
                {ancestors.length > 0 && <small>{ancestors.map(item => item.title).join(' / ')}</small>}
              </span>
              {index === selected && <CornerDownLeft className="search-enter" size={16} aria-hidden="true" />}
            </button>
          )
        })}
        </div>
        {results.length === 0 && <p className="dialog-empty" role="status">
          {t(loading ? 'searchLoading' : failed ? 'searchUnavailable' : 'noResults')}
        </p>}
      </div>
      <div className="search-help">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t('navigate')}</span>
        <span><kbd>↵</kbd> {t('open')}</span>
        <span><kbd>esc</kbd> {t('close')}</span>
      </div>
    </Dialog>
  )
}
