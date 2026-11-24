'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CornerDownLeft, FileText, Search, X } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import type { Page } from '@/lib/types'
import { pagePath } from '@/lib/workspace'
import { workspaceSearch } from '@/lib/workspace-search'
import type { CloudSearchResult } from '@/lib/cloud/search'
import { forgetCloudSearchPage, readCloudSearchPages, subscribeCloudSearchPages } from '@/lib/cloud/local-search'

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
  cloudSubject,
  initialQuery = '',
  onOpen,
  onOpenCloud,
  onClose,
  titleOnly = false,
}: {
  pages?: Page[]
  cloudSubject?: string
  initialQuery?: string
  onOpen?: (id: string) => void
  onOpenCloud?: (id: string) => void
  onClose: () => void
  titleOnly?: boolean
}) {
  const t = useTranslations('app-shell')
  const label = t(titleOnly ? 'quickSwitch' : 'searchPages')
  const resultsId = useId()
  const [query, setQuery] = useState(initialQuery)
  const [highlight, setHighlight] = useState(0)
  const [cloud, setCloud] = useState(!pages)
  const [remote, setRemote] = useState<{
    subject?: string; query: string; pages: CloudSearchResult[] | null; denied?: boolean; inaccessible?: string[]
  }>()
  const [cachedCloud, setCachedCloud] = useState<{ subject: string; pages: Page[] }>()
  const term = query.trim()
  const input = useRef<HTMLInputElement>(null)
  const row = useRef<HTMLButtonElement>(null)
  const currentRemote = remote?.subject === cloudSubject ? remote : undefined
  const loading = cloud && currentRemote?.query !== term
  const failed = cloud && !loading && currentRemote?.pages === null
  const indexedPages = cloud
    ? !currentRemote?.denied && cachedCloud?.subject === cloudSubject ? cachedCloud?.pages : undefined
    : pages
  const immediate = useMemo(() => indexedPages
    ? workspaceSearch(indexedPages).query(query, term ? 15 : 8, titleOnly).map(({ page, context }) => ({
      id: page.id, title: page.title, context: context ?? null,
    })) : [], [indexedPages, query, term, titleOnly])
  const copyIds = cloud ? immediate.map(({ id }) => id).join(',') : ''
  const verified = cloud && !loading ? currentRemote?.pages : undefined
  const candidates = verified?.length ? [...new Map([...immediate, ...verified].map(match => [match.id, match])).values()] : immediate
  const inaccessible = cloud ? currentRemote?.inaccessible : undefined
  const results = inaccessible?.length ? candidates.filter(match => !inaccessible.includes(match.id)) : candidates
  const selected = Math.min(highlight, results.length - 1)
  const open = cloud ? onOpenCloud : onOpen

  useEffect(() => {
    if (!cloud || !cloudSubject) return
    let version = 0
    function refresh(subject: string) {
      const revision = ++version
      void readCloudSearchPages(subject).then(pages => {
        if (revision === version) setCachedCloud({ subject, pages })
      }).catch(() => undefined)
    }
    const unsubscribe = subscribeCloudSearchPages(cloudSubject, () => refresh(cloudSubject))
    refresh(cloudSubject)
    return () => { version++; unsubscribe() }
  }, [cloud, cloudSubject])

  useEffect(() => {
    if (!cloud) return
    const request = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const reply = await fetch('/api/search?' + new URLSearchParams({ q: term, ...(copyIds ? { copies: copyIds } : {}) }), {
          cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        })
        if (reply.status === 401 || reply.status === 403) {
          if (!request.signal.aborted) setRemote({ subject: cloudSubject, query: term, pages: null, denied: true })
          return
        }
        if (!reply.ok) throw new Error('Search failed.')
        const { pages, copies }: { pages: CloudSearchResult[]; copies?: string[] } = await reply.json()
        if (request.signal.aborted) return
        const inaccessible = copies ? copyIds.split(',').filter(id => id && !copies.includes(id)) : []
        setRemote(previous => ({
          subject: cloudSubject, query: term, pages,
          inaccessible: [...new Set([...(previous?.subject === cloudSubject ? previous?.inaccessible ?? [] : []), ...inaccessible])],
        }))
        if (cloudSubject) for (const id of inaccessible) void forgetCloudSearchPage(cloudSubject, id).catch(() => undefined)
      } catch {
        if (!request.signal.aborted) setRemote(previous => ({
          subject: cloudSubject, query: term, pages: null,
          denied: previous?.subject === cloudSubject && previous?.denied,
          inaccessible: previous?.subject === cloudSubject ? previous?.inaccessible : undefined,
        }))
      }
    }, term ? 100 : 0)
    return () => {
      clearTimeout(timer)
      request.abort()
    }
  }, [term, cloud, cloudSubject, copyIds])

  useEffect(() => {
    row.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <Dialog title={label} onClose={onClose} className="search-dialog">
      <div className="search-input-row">
        <Search size={19} aria-hidden="true" />
        <input
          ref={input}
          autoFocus
          type="search"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={resultsId}
          aria-activedescendant={selected >= 0 ? `${resultsId}-${results[selected].id}` : undefined}
          placeholder={t(titleOnly ? 'findPageTitle' : 'findPageOrPhrase')}
          maxLength={cloud ? 160 : undefined}
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (results.length === 0) return
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
        <div id={resultsId} role="listbox" aria-label={t('matchingPages')} aria-busy={loading && results.length === 0}>
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
        {failed && results.length > 0 && <p className="dialog-empty" role="status">{t('searchLocalCloudCopies')}</p>}
      </div>
      <div className="search-help">
        <span><kbd>↑</kbd><kbd>↓</kbd> {t('navigate')}</span>
        <span><kbd>↵</kbd> {t('open')}</span>
        <span><kbd>esc</kbd> {t('close')}</span>
      </div>
    </Dialog>
  )
}
