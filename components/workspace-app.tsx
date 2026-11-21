'use client'

import {
  ArrowDownToLine, ArrowUpFromLine, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleAlert, FileText, FolderClosed, List, LoaderCircle, Menu, MoreHorizontal,
  PanelRight, Plus, Search, Star, X, Link2, MoveRight, Trash2, Pencil, CornerDownRight, NotebookPen,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { Page } from '@/lib/types'
import {
  createPage, deletePage, fromMarkdownFile, getBacklinks, pageChoices, pageHeadings,
  pagePath, resolvePage, updatePage,
} from '@/lib/workspace'
import { downloadPage, downloadWorkspace } from '@/lib/downloads'
import { useWorkspace } from '@/lib/use-workspace'
import type { SaveStatus } from '@/lib/use-workspace'
import { Dialog, SearchDialog } from './workspace-dialogs'
import PageEditor from './page-editor'

const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function statusText(status: SaveStatus) {
  switch (status) {
    case 'loading': return 'Opening workspace'
    case 'saving': return 'Saving…'
    case 'saved': return 'Saved locally'
    case 'error': return 'Save unavailable'
    case 'conflict': return 'Unsaved changes'
  }
}

type PageAction = { kind: 'move' | 'delete'; id: string } | { kind: 'link'; target: string } | { kind: 'reload' }

export default function WorkspaceApp() {
  const { workspace, status, change, retry, reload } = useWorkspace()
  const [searchOpen, setSearchOpen] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const [mobileContext, setMobileContext] = useState(false)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [action, setAction] = useState<PageAction | null>(null)
  const [focusTitle, setFocusTitle] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [titleFocusRequest, setTitleFocusRequest] = useState(0)
  const importInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const pageMenu = useRef<HTMLDetailsElement>(null)
  const anchorToOpen = useRef<string | null>(null)
  const navigationToggle = useRef<HTMLButtonElement>(null)
  const contextToggle = useRef<HTMLButtonElement>(null)
  const navClose = useRef<HTMLButtonElement>(null)
  const contextClose = useRef<HTMLButtonElement>(null)

  const pages = workspace?.pages ?? emptyPages
  const page = pages.find(item => item.id === workspace?.activePageId) ?? pages[0]
  const trail = useMemo(() => page ? pagePath(pages, page.id) : [], [pages, page])
  const links = useMemo(() => page ? getBacklinks(pages, page.id) : [], [pages, page])
  const headings = useMemo(() => page ? pageHeadings(page.markdown) : [], [page])
  const choices = useMemo(() => pageChoices(pages).filter(item => item.id !== page?.id), [pages, page?.id])
  const favorites = pages.filter(item => item.favorite)

  useEffect(() => {
    if (titleFocusRequest) titleInput.current?.focus()
  }, [titleFocusRequest])

  useEffect(() => {
    function closeOnOutside(event: PointerEvent) {
      const menu = pageMenu.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [])

  const open = useCallback((id: string) => {
    change(state => state.activePageId === id ? state : { ...state, activePageId: id })
    setFocusTitle(null)
    setSearchOpen(false)
    setNavigationOpen(false)
    setMobileContext(false)
    if (pageMenu.current) pageMenu.current.open = false
  }, [change])

  const add = useCallback((parentId: string | null = null, title?: string, markdown?: string) => {
    let createdId: string | null = null
    change(state => {
      const next = createPage(state, { parentId, title, markdown })
      createdId = next.activePageId
      return next
    })
    if (parentId) setCollapsed(previous => previous.filter(id => id !== parentId))
    setFocusTitle(createdId)
    setNavigationOpen(false)
    setSearchOpen(false)
    setAction(null)
  }, [change])

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        setNavigationOpen(false)
        setMobileContext(false)
        if (pageMenu.current?.open) {
          pageMenu.current.open = false
          pageMenu.current.querySelector('summary')?.focus()
        }
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() === 'k' && !event.shiftKey && !event.defaultPrevented) {
        event.preventDefault()
        setSearchOpen(previous => !previous)
      }
      if (event.shiftKey && event.key.toLowerCase() === 'n' && workspace) {
        event.preventDefault()
        add()
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  }, [add, workspace])

  function openToday() {
    const now = new Date()
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map(value => String(value).padStart(2, '0')).join('-')
    const title = `Daily · ${date}`
    const existing = pages.find(item => item.title === title && item.parentId === null)
    if (existing) open(existing.id)
    else add(null, title, '## Notes\n\n## Tasks\n\n- [ ] ')
  }

  function handleLink(target: string) {
    const match = resolvePage(pages, target, page?.id)
    if (!match) {
      setAction({ kind: 'link', target })
      return
    }
    const anchor = target.split('#')[1]?.trim()
    if (anchor && match.id === page?.id) {
      const index = headings.findIndex(heading => heading.text.toLowerCase() === anchor.toLowerCase())
      if (index >= 0) jumpToHeading(index)
    } else {
      anchorToOpen.current = anchor || null
      open(match.id)
    }
  }

  function createLinkedPage(target: string) {
    const parts = target.split('#')[0].split('/').map(part => part.trim()).filter(Boolean)
    let newId: string | null = null
    change(state => {
      let next = state
      let parentId: string | null = null
      for (const title of parts) {
        const existing = next.pages.find(item => item.parentId === parentId && item.title.toLowerCase() === title.toLowerCase())
        if (existing) {
          parentId = existing.id
        } else {
          next = createPage(next, { parentId, title })
          parentId = next.activePageId
        }
      }
      newId = parentId
      return parentId ? { ...next, activePageId: parentId } : next
    })
    setCollapsed([])
    setFocusTitle(newId)
    setAction(null)
  }

  async function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    try {
      const supported = files.filter(file => /\.(md|markdown|txt)$/i.test(file.name))
      if (!supported.length) {
        setNotice('Choose Markdown or text files to import.')
        return
      }
      if (supported.some(file => file.size > 8_000_000) || supported.reduce((sum, file) => sum + file.size, 0) > 32_000_000) {
        setNotice('Choose files under 8 MB each and 32 MB total.')
        return
      }
      const imported = await Promise.all(supported.map(async file => fromMarkdownFile(file.name, await file.text())))
      change(state => imported.reduce((next, file) => createPage(next, file), state))
      setNotice(`Imported ${imported.length} ${imported.length === 1 ? 'page' : 'pages'}.`)
      setNavigationOpen(false)
    } catch {
      setNotice('The selected files could not be read.')
    }
  }

  function exportAll() {
    try {
      downloadWorkspace(pages)
      setNotice('Workspace export started.')
    } catch {
      setNotice('Workspace export failed.')
    }
  }

  function withMenuClosed(run: () => void) {
    if (pageMenu.current) pageMenu.current.open = false
    run()
  }

  function toggleContext() {
    if (window.matchMedia('(max-width: 1180px)').matches) setMobileContext(previous => !previous)
    else setContextOpen(previous => !previous)
  }

  function jumpToHeading(index: number) {
    const target = document.querySelectorAll<HTMLElement>('.writer-content > :is(h1,h2,h3,h4,h5,h6)')[index]
    if (target) {
      target.tabIndex = -1
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'start' })
    }
    setMobileContext(false)
  }

  useEffect(() => {
    if (navigationOpen) navClose.current?.focus()
  }, [navigationOpen])

  useEffect(() => {
    if (mobileContext) contextClose.current?.focus()
  }, [mobileContext])

  useEffect(() => {
    const anchor = anchorToOpen.current
    if (!anchor) return
    const container = document.querySelector('.document-scroll')
    if (!container) return
    function findAnchor() {
      const target = Array.from(container!.querySelectorAll<HTMLElement>('.writer-content > :is(h1,h2,h3,h4,h5,h6)'))
        .find(heading => heading.textContent.trim().toLowerCase() === anchor?.toLowerCase())
      if (!target) return false
      anchorToOpen.current = null
      target.scrollIntoView({ block: 'start' })
      return true
    }
    if (findAnchor()) return
    const observer = new MutationObserver(() => { if (findAnchor()) observer.disconnect() })
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [page?.id])

  const actionPage = action && 'id' in action ? pages.find(item => item.id === action.id) : undefined
  const descendants = actionPage
    ? pages.filter(item => pagePath(pages, item.id).some(ancestor => ancestor.id === actionPage.id))
    : []
  const displayPage = page?.title || 'Untitled'
  const words = page?.markdown.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0

  return (
    <div className="workspace" data-context={contextOpen ? 'open' : 'closed'}>
      {navigationOpen && <button className="pane-scrim nav-scrim" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
      <aside className={`sidebar ${navigationOpen ? 'pane-open' : ''}`} aria-label="Workspace navigation" inert={mobileContext}>
        <div className="identity">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div><span className="brand-name">Lekhan</span><span className="workspace-name">Personal workspace</span></div>
          <button className="icon-button close-sidebar" ref={navClose} aria-label="Close navigation" onClick={() => { setNavigationOpen(false); requestAnimationFrame(() => navigationToggle.current?.focus()) }}>
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-actions">
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} /><span>Find a page</span><kbd>⌘ K</kbd>
          </button>
          <button className="nav-action" onClick={openToday} disabled={!workspace}>
            <CalendarDays size={17} /><span>Today</span>
          </button>
        </div>
        <nav className="page-nav" aria-label="Pages">
          {favorites.length > 0 && (
            <section className="nav-section" aria-label="Favorites">
              <div className="nav-heading"><span>Favorites</span></div>
              {favorites.map(item => (
                <button key={item.id} className="favorite-row" onClick={() => open(item.id)}>
                  <Star size={14} aria-hidden="true" /><span>{item.title}</span>
                </button>
              ))}
            </section>
          )}
          <section className="nav-section" aria-label="All pages">
            <div className="nav-heading">
              <span>Pages</span>
              <button className="icon-button small-icon" aria-label="Add top-level page" title="Add top-level page" disabled={!workspace} onClick={() => add()}><Plus size={16} /></button>
            </div>
            <PageTree
              parentId={null}
              pages={pages}
              currentId={page?.id}
              collapsed={collapsed}
              onOpen={open}
              onToggle={id => setCollapsed(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])}
            />
            {workspace && pages.length === 0 && <p className="nav-empty">Your pages will appear here.</p>}
          </section>
        </nav>
        <div className="sidebar-footer">
          <button className="new-page-button" disabled={!workspace} onClick={() => add()}><Plus size={18} /> New page</button>
          <div className="file-actions">
            <button className="nav-action" disabled={!workspace} onClick={() => importInput.current?.click()}><ArrowUpFromLine size={15} /> Import</button>
            <button className="nav-action" disabled={!pages.length} onClick={exportAll}><ArrowDownToLine size={15} /> Export</button>
          </div>
        </div>
      </aside>

      <main className="main-panel" inert={navigationOpen || mobileContext}>
        <header className="topbar">
          <button className="icon-button open-sidebar" ref={navigationToggle} aria-label="Open navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={21} /></button>
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <BookOpen className="breadcrumb-icon" size={16} aria-hidden="true" />
            {trail.length === 0 && <span>Workspace</span>}
            {trail.map((item, index) => index === trail.length - 1
              ? <span key={item.id} aria-current="page">{item.title}</span>
              : <span className="crumb-parent" key={item.id}><button onClick={() => open(item.id)}>{item.title}</button><ChevronRight size={13} /></span>)}
          </nav>
          <div className="top-actions">
            <span className="save-status" data-status={status} role="status">
              {status === 'saved' ? <Check size={15} /> : status === 'saving' || status === 'loading'
                ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}
              <span>{statusText(status)}</span>
            </span>
            {page && (
              <>
                <button
                  className="icon-button favorite-button"
                  aria-label={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  title={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-pressed={page.favorite}
                  onClick={() => change(state => updatePage(state, page.id, { favorite: !page.favorite }))}
                ><Star size={18} fill={page.favorite ? 'currentColor' : 'none'} /></button>
                <details className="page-menu" ref={pageMenu}>
                  <summary className="icon-button" aria-label="Page actions" title="Page actions"><MoreHorizontal size={21} /></summary>
                  <div className="page-menu-content">
                    <button onClick={() => withMenuClosed(() => setTitleFocusRequest(value => value + 1))}><Pencil size={16} /> Rename page</button>
                    <button onClick={() => withMenuClosed(() => add(page.id))}><CornerDownRight size={16} /> New subpage</button>
                    <button onClick={() => withMenuClosed(() => setAction({ kind: 'move', id: page.id }))}><MoveRight size={16} /> Move page</button>
                    <button onClick={() => withMenuClosed(() => downloadPage(page))}><ArrowDownToLine size={16} /> Export Markdown</button>
                    <button className="destructive-text" onClick={() => withMenuClosed(() => setAction({ kind: 'delete', id: page.id }))}><Trash2 size={16} /> Delete page</button>
                  </div>
                </details>
              </>
            )}
            <button className="icon-button context-trigger" ref={contextToggle} aria-label="Toggle page context" title="Toggle page context" onClick={toggleContext} disabled={!page}>
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        {workspace && (status === 'error' || status === 'conflict') && (
          <div className="save-warning" role="alert">
            {status === 'conflict' ? 'This workspace changed in another tab. Export your edits before opening the latest saved copy.' : 'Lekhan couldn’t save your edits to this browser.'}
            <button onClick={exportAll} disabled={!pages.length}>Export edits</button>
            {status === 'error' ? <button onClick={() => void retry()}>Retry save</button> : <button onClick={() => setAction({ kind: 'reload' })}>Open saved copy</button>}
          </div>
        )}

        {page ? (
          <div className="document-scroll" key={page.id}>
            <article className="document">
              <div className="document-meta">
                <span className="page-emblem"><NotebookPen size={22} strokeWidth={1.65} /></span>
                <time dateTime={page.updatedAt}>{dateLabel.format(new Date(page.updatedAt))}</time>
              </div>
              <textarea
                key={`${page.id}:${page.title}`}
                ref={titleInput}
                rows={1}
                maxLength={160}
                className="document-title"
                aria-label="Page title"
                defaultValue={displayPage}
                autoFocus={focusTitle === page.id}
                spellCheck={false}
                onFocus={event => {
                  if (focusTitle === page.id) event.currentTarget.select()
                }}
                onBlur={event => {
                  const title = event.currentTarget.value.trim() || 'Untitled'
                  if (title !== page.title) change(state => updatePage(state, page.id, { title }))
                  if (focusTitle === page.id) setFocusTitle(null)
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.key !== 'Enter') return
                  event.preventDefault()
                  event.currentTarget.blur()
                  document.querySelector<HTMLElement>('.writer-content')?.focus()
                }}
              />
              <PageEditor
                markdown={page.markdown}
                pageId={page.id}
                choices={choices}
                onChange={markdown => change(state => updatePage(state, page.id, { markdown }))}
                onOpenLink={handleLink}
              />
            </article>
          </div>
        ) : (
          <div className="workspace-empty">
            <span className="page-emblem"><NotebookPen size={24} /></span>
            <h1>{!workspace && status === 'error' ? 'Workspace unavailable' : workspace ? 'Start with a page' : 'Opening your workspace'}</h1>
            {workspace
              ? <button className="primary-button" onClick={() => add()}><Plus size={17} /> New page</button>
              : status === 'error'
                ? <button className="primary-button" onClick={() => void reload()}>Try again</button>
                : <LoaderCircle className="spin" size={22} aria-hidden="true" />}
          </div>
        )}
        <footer className="editor-footer">
          <span>{page ? `${words} ${words === 1 ? 'word' : 'words'}` : 'Lekhan'}</span>
          {page && <button onClick={() => setSearchOpen(true)} aria-label="Find a page"><Search size={13} /> Quick search</button>}
        </footer>
      </main>

      {mobileContext && <button className="pane-scrim context-scrim" aria-label="Close page context" onClick={() => setMobileContext(false)} />}
      <aside className={`context-panel ${mobileContext ? 'pane-open' : ''}`} aria-label="Page context">
        <div className="context-header">
          <PanelRight size={17} aria-hidden="true" />
          <h2>Page context</h2>
          <button className="icon-button" ref={contextClose} aria-label="Close page context" title="Close page context" onClick={() => {
            setContextOpen(false)
            setMobileContext(false)
            requestAnimationFrame(() => contextToggle.current?.focus())
          }}><X size={16} /></button>
        </div>
        {page && (
          <div className="context-body">
            <section className="context-section">
              <h3><List size={16} /> On this page</h3>
              {headings.length ? (
                <ol className="outline-list">
                  {headings.map((heading, index) => (
                    <li key={`${heading.text}-${index}`}><button onClick={() => jumpToHeading(index)} style={{ paddingInlineStart: 8 + Math.max(0, heading.level - 2) * 10 }}>{heading.text}</button></li>
                  ))}
                </ol>
              ) : <p className="context-empty">Headings will appear here.</p>}
            </section>
            <section className="context-section">
              <h3><Link2 size={16} /> Backlinks <span className="count">{links.length}</span></h3>
              {links.length ? links.map(({ page: source, excerpt }) => (
                <button className="backlink" key={source.id} onClick={() => open(source.id)}>
                  <span><FileText size={15} /> {source.title} <ChevronRight size={13} /></span>
                  {excerpt && <small>{excerpt}</small>}
                </button>
              )) : <p className="context-empty">No other pages link here yet.</p>}
            </section>
          </div>
        )}
      </aside>

      <input hidden type="file" multiple ref={importInput} accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={importFiles} />
      {searchOpen && <SearchDialog pages={pages} onOpen={open} onClose={() => setSearchOpen(false)} />}
      {action?.kind === 'move' && actionPage && (
        <Dialog title="Move page" onClose={() => setAction(null)}>
          <form className="form-dialog" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const parentId = new FormData(event.currentTarget).get('parent')?.toString() || null
            change(state => updatePage(state, actionPage.id, { parentId }))
            if (parentId) setCollapsed(previous => previous.filter(id => id !== parentId))
            setAction(null)
          }}>
            <h2>Move page</h2>
            <label>Destination
              <select name="parent" defaultValue={actionPage.parentId ?? ''} autoFocus>
                <option value="">Top level</option>
                {pages.filter(item => !descendants.some(child => child.id === item.id)).map(item => (
                  <option key={item.id} value={item.id}>{pagePath(pages, item.id).map(parent => parent.title).join(' / ')}</option>
                ))}
              </select>
            </label>
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setAction(null)}>Cancel</button><button className="primary-button">Move page</button></div>
          </form>
        </Dialog>
      )}
      {action?.kind === 'delete' && actionPage && (
        <Dialog title="Delete page" onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>Delete {actionPage.title}?</h2>
            <p>{descendants.length > 1 ? `This also deletes its ${descendants.length - 1} nested ${descendants.length === 2 ? 'page' : 'pages'}.` : 'This removes the page from this workspace.'} This cannot be undone.</p>
            <div className="dialog-actions">
              <button className="secondary-button" autoFocus onClick={() => setAction(null)}>Cancel</button>
              <button className="danger-button" onClick={() => {
                change(state => deletePage(state, actionPage.id))
                setAction(null)
              }}>Delete {descendants.length > 1 ? 'pages' : 'page'}</button>
            </div>
          </div>
        </Dialog>
      )}
      {action?.kind === 'link' && (
        <Dialog title="Unresolved page link" onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>Page linked as {action.target}</h2>
            <p>Lekhan couldn’t find a single page for this link. Search existing pages or create a new page at this location.</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => { setAction(null); setSearchOpen(true) }}>Search pages</button>
              <button className="primary-button" onClick={() => createLinkedPage(action.target)}>Create page</button>
            </div>
          </div>
        </Dialog>
      )}
      {action?.kind === 'reload' && (
        <Dialog title="Open saved copy" onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>Open the saved copy?</h2>
            <p>Unsaved changes in this tab will be discarded. Export them first if you want to keep a copy.</p>
            <div className="dialog-actions">
              <button autoFocus className="secondary-button" onClick={() => setAction(null)}>Cancel</button>
              <button className="primary-button" onClick={() => { setAction(null); void reload() }}>Open saved copy</button>
            </div>
          </div>
        </Dialog>
      )}
      <div className={`notice ${notice ? 'visible' : ''}`} aria-live="polite">
        {notice && <><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16} /></button></>}
      </div>
    </div>
  )
}

const emptyPages: Page[] = []

interface PageTreeProps {
  parentId: string | null
  pages: Page[]
  currentId: string | undefined
  collapsed: string[]
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

function PageTree({ parentId, pages, currentId, collapsed, onOpen, onToggle }: PageTreeProps) {
  const children = pages.filter(page => page.parentId === parentId)
  if (!children.length) return null
  return (
    <ul className={`page-tree ${parentId ? 'nested-tree' : ''}`}>
      {children.map(page => {
        const hasChildren = pages.some(child => child.parentId === page.id)
        const expanded = !collapsed.includes(page.id)
        return (
          <li key={page.id}>
            <div className="page-row" data-active={currentId === page.id}>
              {hasChildren ? (
                <button className="tree-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${page.title}`} aria-expanded={expanded} onClick={() => onToggle(page.id)}>
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              ) : <span className="tree-spacer" />}
              <button className="page-row-link" aria-current={currentId === page.id ? 'page' : undefined} onClick={() => onOpen(page.id)}>
                {hasChildren ? <FolderClosed size={16} /> : <FileText size={16} />}<span>{page.title}</span>
              </button>
            </div>
            {expanded && hasChildren && <PageTree parentId={page.id} pages={pages} currentId={currentId} collapsed={collapsed} onOpen={onOpen} onToggle={onToggle} />}
          </li>
        )
      })}
    </ul>
  )
}
