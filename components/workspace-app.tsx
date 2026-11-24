'use client'

import {
  ArrowDownToLine, ArrowUpFromLine, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleAlert, FileText, FolderClosed, List, LoaderCircle, Menu, MoreHorizontal,
  Cloud, PanelRight, Plus, Search, Star, X, Link2, MoveRight, Trash2, Pencil, CornerDownRight, NotebookPen, Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import type { Page } from '@/lib/types'
import {
  applyVaultImport, createPage, deletePage, getBacklinks, pageChoices, pageHeadings,
  pagePath, resolvePage, updatePage,
} from '@/lib/workspace'
import { pageTags, workspaceSearch } from '@/lib/workspace-search'
import { downloadPage, downloadWorkspace } from '@/lib/downloads'
import { useWorkspace } from '@/lib/use-workspace'
import type { SaveStatus } from '@/lib/use-workspace'
import type { WorkspaceStorage } from '@/lib/storage'
import { Dialog, SearchDialog } from './workspace-dialogs'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import AssistantDialog, { type LocalAssistantModel } from './assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'
import PageEditor from './page-editor'
import { VaultImportDialog } from './vault-import-dialog'
import type { ImportReport, VaultImportPlan } from '@/lib/vault-import'
import { track, trackMilestone } from '@/lib/analytics'
import { AutomaticMirrorUnavailable, localMirrorPlacement, MirrorRejected, nextAutomaticMirror, prepareLocalMirror, uploadLocalMirror } from '@/lib/cloud/local-mirror'

const statusMessage: Record<SaveStatus, string> = {
  loading: 'openingWorkspace', saving: 'saving', saved: 'savedLocally', error: 'saveUnavailable', conflict: 'unsavedChanges',
}

type PageAction = { kind: 'move' | 'delete' | 'mirror'; id: string } | { kind: 'link'; target: string } | { kind: 'reload' }

function renderedHeadings(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLElement>('.writer-content > :is(h1,h2,h3,h4,h5,h6)'))
}

function scrollToHeading(target: HTMLElement) {
  target.closest<HTMLElement>('.writer-content')?.focus({ preventScroll: true })
  window.getSelection()?.collapse(target, 0)
  target.scrollIntoView({ block: 'start' })
}

export default function WorkspaceApp({ storageScope = 'personal', mirrorEnabled = false, automaticMirror = false,
  sidebarControls, openCloudPage, storage, workspaceName, pageAttachments, localModel, localModels, providerTransport }: {
  storageScope?: string; mirrorEnabled?: boolean; automaticMirror?: boolean
  sidebarControls?: ReactNode | ((canSwitch: boolean) => ReactNode); openCloudPage?: (id: string) => void
  storage?: WorkspaceStorage; workspaceName?: string
  pageAttachments?: (page: Page, insert: ((markdown: string) => void) | undefined) => ReactNode
  localModel?: LocalAssistantModel
  localModels?: readonly LocalAssistantModel[]
  providerTransport?: ProviderTransport
}) {
  const t = useTranslations('app-shell')
  const desktopText = useTranslations('desktop')
  const editorText = useTranslations('editor-chrome')
  const locale = useLocale()
  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }), [locale])
  const { workspace, status, change, persistChange, retry, reload } = useWorkspace(storageScope, storage)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const [mobileContext, setMobileContext] = useState(false)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [action, setAction] = useState<PageAction | null>(null)
  const [focusTitle, setFocusTitle] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [titleFocusRequest, setTitleFocusRequest] = useState(0)
  const [titleDraft, setTitleDraft] = useState<{id: string; value: string} | null>(null)
  const [syncingPage, setSyncingPage] = useState<string | null>(null)
  const [syncFailure, setSyncFailure] = useState<{ id: string; message: string } | null>(null)
  const [paidSyncEnded, setPaidSyncEnded] = useState(false)
  const mirrorRequest = useRef<AbortController | null>(null)
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
  const mirror = page?.cloudMirror
  const localReadOnly = !!mirror || syncingPage === page?.id
  const trail = useMemo(() => page ? pagePath(pages, page.id) : [], [pages, page])
  const links = useMemo(() => page ? getBacklinks(pages, page.id) : [], [pages, page])
  const headings = useMemo(() => page ? pageHeadings(page.markdown) : [], [page])
  const choices = useMemo(() => pageChoices(pages).filter(item => item.id !== page?.id), [pages, page?.id])
  const tags = useMemo(() => page ? pageTags(page) : [], [page])
  const favorites = pages.filter(item => item.favorite)

  useEffect(() => () => mirrorRequest.current?.abort(), [])

  useEffect(() => {
    if (!pages.length) return
    const timer = setTimeout(() => { workspaceSearch(pages) }, 650)
    return () => clearTimeout(timer)
  }, [pages])

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
    setSearchQuery('')
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
    }, () => trackMilestone('page_created'))
    if (parentId) setCollapsed(previous => previous.filter(id => id !== parentId))
    setFocusTitle(createdId)
    setNavigationOpen(false)
    setSearchOpen(false)
    setSearchQuery('')
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
        setSearchQuery('')
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
      const target = renderedHeadings(document).find(heading => heading.textContent.trim().toLowerCase() === anchor.toLowerCase())
      if (target) scrollToHeading(target)
    } else {
      anchorToOpen.current = anchor || null
      open(match.id)
    }
  }

  function createLinkedPage(target: string) {
    const parts = target.split('#')[0].split('/').map(part => part.trim()).filter(Boolean)
    let newId: string | null = null
    let created = false
    change(state => {
      let next = state
      let parentId: string | null = null
      for (const title of parts) {
        const existing = next.pages.find(item => item.parentId === parentId && item.title.toLowerCase() === title.toLowerCase())
        if (existing) {
          parentId = existing.id
        } else {
          next = createPage(next, { parentId, title })
          created = true
          parentId = next.activePageId
        }
      }
      newId = parentId
      return parentId ? { ...next, activePageId: parentId } : next
    }, () => { if (created) trackMilestone('page_created') })
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
        setNotice(t('chooseImportFiles'))
        return
      }
      if (supported.some(file => file.size > 8_000_000) || supported.reduce((sum, file) => sum + file.size, 0) > 32_000_000) {
        setNotice(t('importSizeLimit'))
        return
      }
      const { markdownNote } = await import('@/lib/vault-import')
      const imported = await Promise.all(supported.map(async file => markdownNote(file.name, await file.text())))
      change(state => imported.reduce((next, file) => createPage(next, file), state),
        () => track('import_completed', 'markdown', imported.length))
      setNotice(t('importedPages', { count: imported.length }))
      setNavigationOpen(false)
    } catch {
      setNotice(t('importReadError'))
    }
  }

  function importVault(plan: VaultImportPlan): ImportReport | null {
    let report: ImportReport | null = null
    change(state => {
      const result = applyVaultImport(state, plan)
      report = result.report
      return result.workspace
    }, () => {
      if (report && !report.repeated) track('import_completed', 'obsidian', report.notes)
    })
    setCollapsed([])
    return report
  }

  function exportAll() {
    try {
      downloadWorkspace(pages)
      setNotice(t('exportStarted'))
    } catch {
      setNotice(t('exportFailed'))
    }
  }

  function withMenuClosed(run: () => void) {
    if (pageMenu.current) pageMenu.current.open = false
    run()
  }

  const syncLocalPage = useCallback(async (note: Page, automatic = false) => {
    if (mirrorRequest.current || !workspace || !mirrorEnabled || note.cloudMirror?.state === 'linked') return
    const controller = new AbortController()
    mirrorRequest.current = controller
    setSyncFailure(null)
    setSyncingPage(note.id)
    if (!automatic) setAction(null)
    let batch = note.cloudMirror?.batch
    try {
      if (!batch) {
        const notebook = workspace.mirrorNotebookId ?? crypto.randomUUID()
        batch = await prepareLocalMirror(note, controller.signal, localMirrorPlacement(workspace, note, notebook), automatic)
        const pending = { state: 'pending' as const, batch }
        await persistChange(state => state.pages.includes(note) && (!state.mirrorNotebookId || state.mirrorNotebookId === notebook)
          ? { ...state, mirrorNotebookId: notebook, pages: state.pages.map(item => item === note ? { ...item, cloudMirror: pending } : item) } : state)
      }
      const attempt = batch.importId
      controller.signal.throwIfAborted()
      const cloudId = await uploadLocalMirror(batch, controller.signal, automatic)
      controller.signal.throwIfAborted()
      await persistChange(state => {
        const existing = state.pages.find(item => item.id === note.id)
        if (existing?.cloudMirror?.state !== 'pending' || existing.cloudMirror.batch.importId !== attempt) return state
        return { ...state, pages: state.pages.map(item => item === existing
          ? { ...item, cloudMirror: { state: 'linked', pageId: cloudId } } : item) }
      })
      if (!automatic) setNotice('Page synced to your cloud workspace.')
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof AutomaticMirrorUnavailable) setPaidSyncEnded(true)
      if (failure instanceof MirrorRejected && batch) {
        const attempt = batch.importId
        await persistChange(state => {
          const existing = state.pages.find(item => item.id === note.id)
          if (existing?.cloudMirror?.state !== 'pending' || existing.cloudMirror.batch.importId !== attempt) return state
          return { ...state, pages: state.pages.map(item => item === existing ? { ...item, cloudMirror: undefined } : item) }
        }).catch(() => undefined)
      }
      setSyncFailure({ id: note.id, message: failure instanceof Error ? failure.message : 'Could not sync this page.' })
    } finally {
      mirrorRequest.current = null
      if (!controller.signal.aborted) setSyncingPage(null)
    }
  }, [workspace, mirrorEnabled, persistChange])

  useEffect(() => {
    if (!automaticMirror || paidSyncEnded || status !== 'saved' || syncingPage || action || assistantOpen || vaultOpen) return
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!navigator.onLine || syncFailure) return
        const editing = document.activeElement?.closest('.document-title, .writer-content, .writer-source')
        const next = nextAutomaticMirror(pages, editing ? page?.id : undefined)
        if (next) void syncLocalPage(next, true)
      }, 1100)
    }
    function reconnect() {
      setSyncFailure(null)
      schedule()
    }
    schedule()
    window.addEventListener('online', reconnect)
    document.addEventListener('focusout', schedule)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', reconnect)
      document.removeEventListener('focusout', schedule)
    }
  }, [automaticMirror, paidSyncEnded, status, syncingPage, action, assistantOpen, vaultOpen, syncFailure, pages, page?.id, syncLocalPage])

  function toggleContext() {
    if (window.matchMedia('(max-width: 1180px)').matches) setMobileContext(previous => !previous)
    else setContextOpen(previous => !previous)
  }

  function jumpToHeading(index: number) {
    const moveFocus = () => {
      const target = renderedHeadings(document)[index]
      if (target) {
        scrollToHeading(target)
        return
      }
      const source = document.querySelector<HTMLTextAreaElement>('textarea.writer-source')
      const heading = headings[index]
      if (!source || !heading || heading.offset < 0) return
      source.focus({ preventScroll: true })
      source.setSelectionRange(heading.offset, heading.offset)
      const before = source.value.slice(0, heading.offset).split('\n').length - 1
      const lineHeight = Number.parseFloat(getComputedStyle(source).lineHeight)
      const offset = before * lineHeight
      if (source.scrollHeight > source.clientHeight) source.scrollTop = offset
      else {
        const panel = source.closest('.document-scroll')
        if (panel) panel.scrollBy(0, source.getBoundingClientRect().top - panel.getBoundingClientRect().top + offset - 24)
      }
    }
    if (mobileContext) {
      setMobileContext(false)
      requestAnimationFrame(moveFocus)
    } else {
      moveFocus()
    }
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
    const match = anchor.toLowerCase()
    const findAnchor = () => {
      const target = renderedHeadings(container)
        .find(heading => heading.textContent.trim().toLowerCase() === match)
      if (!target) return false
      anchorToOpen.current = null
      scrollToHeading(target)
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
  const deletingPendingPage = descendants.some(item => item.id === syncingPage || item.cloudMirror?.state === 'pending')
  const displayPage = page?.title || t('untitled')
  const words = page?.markdown.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0

  return (
    <div className="workspace" data-context={contextOpen ? 'open' : 'closed'}>
      {navigationOpen && <button className="pane-scrim nav-scrim" aria-label={t('closeNavigation')} onClick={() => setNavigationOpen(false)} />}
      <aside className={`sidebar ${navigationOpen ? 'pane-open' : ''}`} aria-label={t('workspaceNavigation')} inert={mobileContext}>
        <div className="identity">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div><span className="brand-name">Lekhan</span><span className="workspace-name" title={workspaceName}>{workspaceName ?? t('personalWorkspace')}</span></div>
          <button className="icon-button close-sidebar" ref={navClose} aria-label={t('closeNavigation')} onClick={() => { setNavigationOpen(false); requestAnimationFrame(() => navigationToggle.current?.focus()) }}>
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-actions">
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} /><span>{t('findPage')}</span><kbd>⌘ K</kbd>
          </button>
          <button className="nav-action" onClick={openToday} disabled={!workspace}>
            <CalendarDays size={17} /><span>{t('today')}</span>
          </button>
        </div>
        <nav className="page-nav" aria-label={t('pages')}>
          {favorites.length > 0 && (
            <section className="nav-section" aria-label={t('favorites')}>
              <div className="nav-heading"><span>{t('favorites')}</span></div>
              {favorites.map(item => (
                <button key={item.id} className="favorite-row" onClick={() => open(item.id)}>
                  <Star size={14} aria-hidden="true" /><span>{item.title}</span>
                </button>
              ))}
            </section>
          )}
          <section className="nav-section" aria-label={t('allPages')}>
            <div className="nav-heading">
              <span>{t('pages')}</span>
              <button className="icon-button small-icon" aria-label={t('addTopLevelPage')} title={t('addTopLevelPage')} disabled={!workspace} onClick={() => add()}><Plus size={16} /></button>
            </div>
            <PageTree
              parentId={null}
              pages={pages}
              currentId={page?.id}
              collapsed={collapsed}
              onOpen={open}
              onToggle={id => setCollapsed(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])}
            />
            {workspace && pages.length === 0 && <p className="nav-empty">{t('pagesEmpty')}</p>}
          </section>
        </nav>
        <div className="sidebar-footer">
          <button className="new-page-button" disabled={!workspace} onClick={() => add()}><Plus size={18} /> {t('newPage')}</button>
          <div className="file-actions">
            <button className="nav-action" disabled={!workspace} onClick={() => importInput.current?.click()}><ArrowUpFromLine size={15} /> {t('import')}</button>
            <button className="nav-action" disabled={!pages.length} onClick={exportAll}><ArrowDownToLine size={15} /> {t('export')}</button>
          </div>
          <button className="nav-action vault-launch" disabled={!workspace} onClick={() => {
            setNavigationOpen(false)
            setVaultOpen(true)
          }}><FolderClosed size={15} /> Import vault</button>
          {typeof sidebarControls === 'function' ? sidebarControls(!workspace || status === 'saved') : sidebarControls}
        </div>
      </aside>

      <main className="main-panel" inert={navigationOpen || mobileContext}>
        <header className="topbar">
          <button className="icon-button open-sidebar" ref={navigationToggle} aria-label={t('openNavigation')} aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={21} /></button>
          <nav className="breadcrumbs" aria-label={t('breadcrumb')}>
            <BookOpen className="breadcrumb-icon" size={16} aria-hidden="true" />
            {trail.length === 0 && <span>{t('workspace')}</span>}
            {trail.map((item, index) => index === trail.length - 1
              ? <span key={item.id} aria-current="page">{item.title}</span>
              : <span className="crumb-parent" key={item.id}><button onClick={() => open(item.id)}>{item.title}</button><ChevronRight size={13} /></span>)}
          </nav>
          <div className="top-actions">
            <span className="save-status" data-status={status} role="status">
              {status === 'saved' ? <Check size={15} /> : status === 'saving' || status === 'loading'
                ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}
              <span>{t(statusMessage[status])}</span>
            </span>
            {page && (
              <>
                <button
                  className="icon-button favorite-button"
                  aria-label={page.favorite ? t('removeFavorite') : t('addFavorite')}
                  title={page.favorite ? t('removeFavorite') : t('addFavorite')}
                  aria-pressed={page.favorite}
                  onClick={() => change(state => updatePage(state, page.id, { favorite: !page.favorite }))}
                ><Star size={18} fill={page.favorite ? 'currentColor' : 'none'} /></button>
                {!localReadOnly && <button className="icon-button" aria-label="Writing assistant" title="Writing assistant" onClick={() => setAssistantOpen(true)}><Sparkles size={17} /></button>}
                <details className="page-menu" ref={pageMenu}>
                  <summary className="icon-button" aria-label={t('pageActions')} title={t('pageActions')}><MoreHorizontal size={21} /></summary>
                  <div className="page-menu-content">
                    {!localReadOnly && <button onClick={() => withMenuClosed(() => setTitleFocusRequest(value => value + 1))}><Pencil size={16} /> {t('renamePage')}</button>}
                    {mirrorEnabled && !mirror && <button disabled={!!syncingPage || status === 'error' || status === 'conflict'}
                      onClick={() => withMenuClosed(() => setAction({ kind: 'mirror', id: page.id }))}><Cloud size={16} /> Sync this page</button>}
                    <button onClick={() => withMenuClosed(() => add(page.id))}><CornerDownRight size={16} /> {t('newSubpage')}</button>
                    <button onClick={() => withMenuClosed(() => setAction({ kind: 'move', id: page.id }))}><MoveRight size={16} /> {t('movePage')}</button>
                    <button onClick={() => withMenuClosed(() => downloadPage(page))}><ArrowDownToLine size={16} /> {mirror?.state === 'linked' ? 'Export local snapshot' : t('exportMarkdown')}</button>
                    {mirror?.state !== 'pending' && syncingPage !== page.id && <button className="destructive-text" onClick={() => withMenuClosed(() => setAction({ kind: 'delete', id: page.id }))}><Trash2 size={16} /> {t('deletePage')}</button>}
                  </div>
                </details>
              </>
            )}
            <button className="icon-button context-trigger" ref={contextToggle} aria-label={t('toggleContext')} title={t('toggleContext')} onClick={toggleContext} disabled={!page}>
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        {workspace && (status === 'error' || status === 'conflict') && (
          <div className="save-warning" role="alert">
            {status === 'conflict' ? storage ? desktopText('externalConflict') : t('saveConflict') : t('saveError')}
            <button onClick={exportAll} disabled={!pages.length}>{t('exportEdits')}</button>
            {status === 'error' ? <button onClick={() => void retry()}>{t('retrySave')}</button> : <button onClick={() => setAction({ kind: 'reload' })}>{t('openSavedCopy')}</button>}
          </div>
        )}
        {automaticMirror && !paidSyncEnded && syncFailure && syncFailure.id !== page?.id && (
          <div className="save-warning" role="alert">
            {syncFailure.message}
            <button onClick={() => setSyncFailure(null)}>Retry notebook sync</button>
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
                ref={titleInput}
                rows={1}
                maxLength={160}
                className="document-title"
                aria-label={editorText('pageTitle')}
                value={titleDraft?.id === page.id ? titleDraft.value : displayPage}
                autoFocus={focusTitle === page.id}
                readOnly={localReadOnly}
                spellCheck={false}
                onFocus={event => {
                  if (focusTitle === page.id) event.currentTarget.select()
                }}
                onChange={event => {
                  const title = event.currentTarget.value
                  setTitleDraft({ id: page.id, value: title })
                  change(state => updatePage(state, page.id, { title }))
                }}
                onBlur={() => {
                  setTitleDraft(null)
                  if (focusTitle === page.id) setFocusTitle(null)
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.key !== 'Enter') return
                  event.preventDefault()
                  event.currentTarget.blur()
                  document.querySelector<HTMLElement>('.writer-content')?.focus()
                }}
              />
              {syncFailure?.id === page.id && <div className="local-mirror-callout" role="alert">
                <p>{syncFailure.message}</p>
                {automaticMirror && !paidSyncEnded && !mirror &&
                  <button type="button" className="secondary-button" onClick={() => setSyncFailure(null)}>Retry notebook sync</button>}
              </div>}
              {syncingPage === page.id && <p role="status">Syncing this page…</p>}
              {mirror?.state === 'pending' && syncingPage !== page.id && <div className="local-mirror-callout">
                <p>The local draft is saved. Retry to confirm its cloud copy.</p>
                <button type="button" className="secondary-button" disabled={!mirrorEnabled || !!syncingPage || status !== 'saved'} onClick={() => void syncLocalPage(page)}>Retry cloud sync</button>
              </div>}
              {mirror?.state === 'linked' ? <div className="local-mirror-callout">
                <p>This page now opens in your cloud workspace. You can export the local snapshot from Page actions.</p>
                <a className="primary-button" href={'/page/' + mirror.pageId} onClick={event => {
                  if (!openCloudPage || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  openCloudPage(mirror.pageId)
                }}><Cloud size={16} /> Open synced page</a>
              </div> : <PageEditor
                markdown={page.markdown}
                pageId={page.id}
                choices={choices}
                editable={!localReadOnly}
                assistant={{ storageScope, localModel, localModels, transport: providerTransport }}
                onChange={markdown => { if (!localReadOnly) change(state => updatePage(state, page.id, { markdown })) }}
                onOpenLink={handleLink}
              />}
            </article>
          </div>
        ) : (
          <div className="workspace-empty">
            <span className="page-emblem"><NotebookPen size={24} /></span>
            <h1>{!workspace && status === 'error' ? t('workspaceUnavailable') : workspace ? t('startWithPage') : t('openingYourWorkspace')}</h1>
            {workspace
              ? <button className="primary-button" onClick={() => add()}><Plus size={17} /> {t('newPage')}</button>
              : status === 'error'
                ? <button className="primary-button" onClick={() => void reload()}>{t('tryAgain')}</button>
                : <LoaderCircle className="spin" size={22} aria-hidden="true" />}
          </div>
        )}
        <footer className="editor-footer">
          <span>{page ? editorText('wordCount', { count: words }) : 'Lekhan'}</span>
          {page && <button onClick={() => setSearchOpen(true)} aria-label={t('findPage')}><Search size={13} /> {editorText('quickSearch')}</button>}
        </footer>
      </main>

      {mobileContext && <button className="pane-scrim context-scrim" aria-label={t('closeContext')} onClick={() => setMobileContext(false)} />}
      <aside className={`context-panel ${mobileContext ? 'pane-open' : ''}`} aria-label={t('pageContext')}>
        <div className="context-header">
          <PanelRight size={17} aria-hidden="true" />
          <h2>{t('pageContext')}</h2>
          <button className="icon-button" ref={contextClose} aria-label={t('closeContext')} title={t('closeContext')} onClick={() => {
            setContextOpen(false)
            setMobileContext(false)
            requestAnimationFrame(() => contextToggle.current?.focus())
          }}><X size={16} /></button>
        </div>
        {page && (
          <div className="context-body">
            {pageAttachments?.(page, localReadOnly || status !== 'saved' ? undefined : markdown => {
              change(state => {
                const current = state.pages.find(note => note.id === page.id)
                return current ? updatePage(state, current.id, { markdown: [current.markdown, markdown].filter(Boolean).join('\n\n') }) : state
              })
            })}
            {page.properties && Object.keys(page.properties).length > 0 && (
              <section className="context-section">
                <h3><FileText size={16} /> Properties</h3>
                <dl className="page-properties">
                  {Object.entries(page.properties).map(([name, value]) => <div key={name}>
                    <dt>{name}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                  </div>)}
                </dl>
              </section>
            )}
            {tags.length > 0 && (
              <section className="context-section">
                <h3><span aria-hidden="true">#</span> Tags</h3>
                <div className="page-tags">
                  {tags.map(tag => <button key={tag} onClick={() => {
                    setMobileContext(false)
                    setSearchQuery('#' + tag)
                    setSearchOpen(true)
                  }}>#{tag}</button>)}
                </div>
              </section>
            )}
            <section className="context-section">
              <h3><List size={16} /> {t('onThisPage')}</h3>
              {headings.length ? (
                <ol className="outline-list">
                  {headings.map((heading, index) => (
                    <li key={`${heading.text}-${index}`}><button onClick={() => jumpToHeading(index)} style={{ paddingInlineStart: 8 + Math.max(0, heading.level - 2) * 10 }}>{heading.text}</button></li>
                  ))}
                </ol>
              ) : <p className="context-empty">{t('headingsEmpty')}</p>}
            </section>
            <section className="context-section">
              <h3><Link2 size={16} /> {t('backlinks')} <span className="count">{new Intl.NumberFormat(locale).format(links.length)}</span></h3>
              {links.length ? links.map(({ page: source, excerpt }) => (
                <button className="backlink" key={source.id} onClick={() => open(source.id)}>
                  <span><FileText size={15} /> {source.title} <ChevronRight size={13} /></span>
                  {excerpt && <small>{excerpt}</small>}
                </button>
              )) : <p className="context-empty">{t('backlinksEmpty')}</p>}
            </section>
          </div>
        )}
      </aside>

      <input hidden type="file" multiple ref={importInput} accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={importFiles} />
      {assistantOpen && page && !localReadOnly && <AssistantDialog key={page.id} page={page} storageScope={storageScope}
        localModel={localModel} localModels={localModels} transport={providerTransport} onClose={() => setAssistantOpen(false)} onInsert={text => {
        change(state => {
          const current = state.pages.find(item => item.id === page.id)
          return current ? updatePage(state, current.id, { markdown: [current.markdown, text].filter(Boolean).join('\n\n') }) : state
        })
      }} />}
      {vaultOpen && <VaultImportDialog onClose={() => setVaultOpen(false)} onImport={importVault} saveStatus={status} />}
      {searchOpen && <SearchDialog pages={pages} initialQuery={searchQuery} onOpen={open}
        onOpenCloud={openCloudPage ? id => {
          setSearchOpen(false)
          setSearchQuery('')
          openCloudPage(id)
        } : undefined}
        onClose={() => { setSearchOpen(false); setSearchQuery('') }} />}
      {action?.kind === 'move' && actionPage && (
        <Dialog title={t('movePage')} onClose={() => setAction(null)}>
          <form className="form-dialog" onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const parentId = new FormData(event.currentTarget).get('parent')?.toString() || null
            change(state => updatePage(state, actionPage.id, { parentId }))
            if (parentId) setCollapsed(previous => previous.filter(id => id !== parentId))
            setAction(null)
          }}>
            <h2>{t('movePage')}</h2>
            <label>{t('destination')}
              <select name="parent" defaultValue={actionPage.parentId ?? ''} autoFocus>
                <option value="">{t('topLevel')}</option>
                {pages.filter(item => !descendants.some(child => child.id === item.id)).map(item => (
                  <option key={item.id} value={item.id}>{pagePath(pages, item.id).map(parent => parent.title).join(' / ')}</option>
                ))}
              </select>
            </label>
            <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setAction(null)}>{t('cancel')}</button><button className="primary-button">{t('movePage')}</button></div>
          </form>
        </Dialog>
      )}
      {action?.kind === 'delete' && actionPage && (
        <Dialog title={t('deletePage')} onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>{t('deletePageTitle', { title: actionPage.title })}</h2>
            <p>{deletingPendingPage ? 'Finish syncing the pending pages before removing this branch.'
              : actionPage.cloudMirror?.state === 'linked' && descendants.length === 1
                ? 'This removes the notebook entry and its local snapshot. Open the cloud page from Cloud workspace.'
                : `${descendants.length > 1 ? t('deleteNested', { count: descendants.length - 1 }) : t('deleteFromWorkspace')} ${t('cannotUndo')}`}</p>
            <div className="dialog-actions">
              <button className="secondary-button" autoFocus onClick={() => setAction(null)}>{t('cancel')}</button>
              <button className="danger-button" disabled={deletingPendingPage} onClick={() => {
                change(state => deletePage(state, actionPage.id))
                setAction(null)
              }}>Delete {descendants.length > 1 ? 'pages' : 'page'}</button>
            </div>
          </div>
        </Dialog>
      )}
      {action?.kind === 'mirror' && actionPage && <Dialog title="Sync this page" onClose={() => setAction(null)}>
        <div className="form-dialog">
          <h2>Sync {actionPage.title}</h2>
          <p>Copy this note to your cloud workspace. Future edits open in the cloud editor.</p>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={() => setAction(null)}>{t('cancel')}</button>
            <button type="button" className="primary-button" onClick={() => void syncLocalPage(actionPage)}>Sync this page</button>
          </div>
        </div>
      </Dialog>}
      {action?.kind === 'link' && (
        <Dialog title={t('unresolvedLink')} onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>{t('linkedAs', { target: action.target })}</h2>
            <p>{t('unresolvedLinkHelp')}</p>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => { setAction(null); setSearchOpen(true) }}>{t('searchPages')}</button>
              <button className="primary-button" onClick={() => createLinkedPage(action.target)}>{t('createPage')}</button>
            </div>
          </div>
        </Dialog>
      )}
      {action?.kind === 'reload' && (
        <Dialog title={t('openSavedCopy')} onClose={() => setAction(null)}>
          <div className="form-dialog">
            <h2>{t('openSavedCopyTitle')}</h2>
          <p>{storage ? desktopText('externalReload') : t('openSavedCopyHelp')}</p>
            <div className="dialog-actions">
              <button autoFocus className="secondary-button" onClick={() => setAction(null)}>{t('cancel')}</button>
              <button className="primary-button" onClick={() => { setAction(null); void reload() }}>{t('openSavedCopy')}</button>
            </div>
          </div>
        </Dialog>
      )}
      <div className={`notice ${notice ? 'visible' : ''}`} aria-live="polite">
        {notice && <><span>{notice}</span><button className="icon-button" aria-label={t('dismissMessage')} onClick={() => setNotice('')}><X size={16} /></button></>}
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
  const t = useTranslations('app-shell')
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
                <button className="tree-toggle" aria-label={t(expanded ? 'collapsePage' : 'expandPage', { title: page.title })} aria-expanded={expanded} onClick={() => onToggle(page.id)}>
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
