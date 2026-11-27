'use client'

import {
  ArrowDownToLine, ArrowUpFromLine, BookOpen, CalendarDays, Check, ChevronRight, ChevronsUpDown,
  CircleAlert, FileText, FolderClosed, Keyboard, List, LoaderCircle, Menu, MoreHorizontal,
  Cloud, PanelRight, Plus, Search, SlidersHorizontal, Star, X, Link2, MoveRight, Trash2, Pencil, CornerDownRight, NotebookPen, Sparkles, Paperclip,
} from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Breadcrumbs, BreadcrumbItem } from '@astryxdesign/core/Breadcrumbs'
import { Button } from '@astryxdesign/core/Button'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { DropdownMenu, type DropdownMenuOption } from '@astryxdesign/core/DropdownMenu'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { Popover } from '@astryxdesign/core/Popover'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TreeList, type TreeListItemData } from '@astryxdesign/core/TreeList'
import type { Page } from '@/lib/types'
import {
  applyVaultImport, createPage, deletePage, getBacklinks, isFolderPage, notebookNavigation, pageChoices, pageHeadings,
  pagePath, resolvePage, updatePage, type PageLocation,
} from '@/lib/workspace'
import { pageTags, workspaceSearch } from '@/lib/workspace-search'
import { attachmentReference } from '@/lib/local-attachments'
import { downloadAttachment, downloadPage, downloadWorkspace } from '@/lib/downloads'
import { useWorkspace } from '@/lib/use-workspace'
import { workspaceShortcut } from '@/lib/workspace-shortcuts'
import type { SaveStatus } from '@/lib/use-workspace'
import type { WorkspaceStorage } from '@/lib/storage'
import { SearchDialog } from './workspace-dialogs'
import WorkspaceShortcutHelp from './workspace-shortcut-help'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import AssistantDialog, { type LocalAssistantModel } from './assistant-dialog'
import type { ProviderTransport } from '@/lib/ai/client'
import PageEditor from './page-editor'
import { VaultImportDialog } from './vault-import-dialog'
import type { ImportReport, VaultImportPlan } from '@/lib/vault-import'
import { AttachmentTransferError } from '@/lib/cloud/attachment-client'
import { VaultImportError } from '@/lib/vault-import-error'
import { track, trackMilestone } from '@/lib/analytics'
import { hasUnsupportedMirrorFile, localMirrorPlacement, MirrorFailure, MirrorRejected, nextAutomaticMirror, prepareLocalMirror, uploadLocalMirror } from '@/lib/cloud/local-mirror'

const statusMessage: Record<SaveStatus, string> = {
  loading: 'openingWorkspace', saving: 'saving', saved: 'savedLocally', error: 'saveUnavailable', conflict: 'unsavedChanges',
}
const navigationBatch = 48
const backlinkBatch = 24

type PageAction = { kind: 'move' | 'delete' | 'mirror'; id: string } | { kind: 'link'; target: string } | { kind: 'reload' }

function renderedHeadings(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLElement>('.writer-content > :is(h1,h2,h3,h4,h5,h6)'))
}

function scrollToHeading(target: HTMLElement) {
  target.closest<HTMLElement>('.writer-content')?.focus({ preventScroll: true })
  window.getSelection()?.collapse(target, 0)
  target.scrollIntoView({ block: 'start' })
}

function restoreListFocus(button: HTMLElement, list: Element | null, rows: string, firstNewRow: number) {
  requestAnimationFrame(() => {
    if (document.activeElement === button || !button.isConnected && document.activeElement === document.body) {
      list?.querySelectorAll<HTMLElement>(rows)[firstNewRow]?.focus()
    }
  })
}

export default function WorkspaceApp({ storageScope = 'personal', mirrorEnabled = false, automaticMirror = false,
  sidebarControls, sidebarNotice, openCloudPage, storage, workspaceName, pageAttachments, localModel, localModels, providerTransport, cloudSearchSubject }: {
  storageScope?: string; mirrorEnabled?: boolean; automaticMirror?: boolean
  sidebarControls?: ReactNode | ((canSwitch: boolean) => ReactNode)
  sidebarNotice?: ReactNode | ((canSwitch: boolean) => ReactNode)
  openCloudPage?: (id: string) => void
  storage?: WorkspaceStorage; workspaceName?: string
  pageAttachments?: (page: Page, insert: ((markdown: string) => void) | undefined) => ReactNode
  localModel?: LocalAssistantModel
  localModels?: readonly LocalAssistantModel[]
  providerTransport?: ProviderTransport
  cloudSearchSubject?: string
}) {
  const t = useTranslations('app-shell')
  const fileText = useTranslations('cloud-dialogs')
  const importText = useTranslations('vault-import')
  const desktopText = useTranslations('desktop')
  const editorText = useTranslations('editor-chrome')
  const aiText = useTranslations('editor-ai')
  const locale = useLocale()
  const dateLabel = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }), [locale])
  const { workspace, status, change, persistChange, retry, reload } = useWorkspace(storageScope, storage)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(true)
  const [mobileContext, setMobileContext] = useState(false)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [treeSyncKey, setTreeSyncKey] = useState(0)
  const [favoriteLimit, setFavoriteLimit] = useState(navigationBatch)
  const [action, setAction] = useState<PageAction | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [focusTitle, setFocusTitle] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [titleFocusRequest, setTitleFocusRequest] = useState(0)
  const [titleDraft, setTitleDraft] = useState<{id: string; value: string} | null>(null)
  const [syncingPage, setSyncingPage] = useState<string | null>(null)
  const [syncFailure, setSyncFailure] = useState<{ id: string; failure: unknown } | null>(null)
  const [paidSyncEnded, setPaidSyncEnded] = useState(false)
  const mirrorRequest = useRef<AbortController | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const optionsTrigger = useRef<HTMLButtonElement>(null)
  const anchorToOpen = useRef<string | null>(null)
  const navigationToggle = useRef<HTMLButtonElement>(null)
  const contextToggle = useRef<HTMLButtonElement>(null)
  const navClose = useRef<HTMLButtonElement>(null)
  const searchTrigger = useRef<HTMLButtonElement>(null)
  const contextClose = useRef<HTMLButtonElement>(null)
  const pageHistory = useRef<{ ids: string[]; position: number }>({ ids: [], position: -1 })

  const pages = workspace?.pages ?? emptyPages
  const page = pages.find(item => item.id === workspace?.activePageId && !isFolderPage(item))
    ?? pages.find(item => !isFolderPage(item))
  const deferredPage = useDeferredValue(page)
  const mirror = page?.cloudMirror
  const localReadOnly = !!mirror || syncingPage === page?.id
  const pageId = page?.id
  const { childPages, favorites, path } = useMemo(() => notebookNavigation(pages), [pages])
  const trail = useMemo(() => pageId ? path(pageId) : emptyTrail, [path, pageId])
  const links = useMemo(() => page ? getBacklinks(pages, page.id) : [], [pages, page])
  const headings = useMemo(() => deferredPage ? pageHeadings(deferredPage.markdown) : [], [deferredPage])
  const choices = useMemo(() => {
    const folders = new Set(pages.filter(isFolderPage).map(item => item.id))
    return pageChoices(pages).filter(choice => !folders.has(choice.id))
  }, [pages])
  const tags = useMemo(() => deferredPage ? pageTags(deferredPage) : [], [deferredPage])
  const activePath = useMemo(() => new Map(trail.map(note => [note.parentId, note.id])), [trail])
  const editorAssistant = useMemo(() => ({ storageScope, localModel, localModels, transport: providerTransport }),
    [storageScope, localModel, localModels, providerTransport])

  useEffect(() => () => mirrorRequest.current?.abort(), [])

  useEffect(() => {
    if (!pages.length) return
    const timer = setTimeout(() => { workspaceSearch(pages) }, 650)
  return () => clearTimeout(timer)
  }, [pages])

  useEffect(() => {
    if (titleFocusRequest) titleInput.current?.focus()
  }, [titleFocusRequest])

  const open = useCallback((id: string) => {
    if (isFolderPage(pages.find(item => item.id === id))) return
    change(state => state.activePageId === id ? state : { ...state, activePageId: id })
    setFocusTitle(null)
    setSearchOpen(false)
    setSwitcherOpen(false)
    setSearchQuery('')
    setNavigationOpen(false)
    setMobileContext(false)
    setOptionsOpen(false)
  }, [change, pages])

  const add = useCallback((parentId: string | null = null, title?: string, markdown?: string) => {
    let createdId: string | null = null
    change(state => {
      const next = createPage(state, { parentId, title, markdown })
      createdId = next.activePageId
      return next
    }, () => trackMilestone('page_created'))
    if (parentId) {
      setCollapsed(previous => previous.filter(id => id !== parentId))
      setTreeSyncKey(key => key + 1)
    }
    setFocusTitle(createdId)
    setNavigationOpen(false)
    setOptionsOpen(false)
    setSearchOpen(false)
    setSearchQuery('')
    setAction(null)
  }, [change])

  useEffect(() => {
    if (!page?.id) return
    const history = pageHistory.current
    if (history.ids[history.position] === page.id) return
    const ids = [...history.ids.slice(0, history.position + 1), page.id].slice(-100)
    pageHistory.current = { ids, position: ids.length - 1 }
  }, [page?.id])

  const toggleNavigation = useCallback(() => {
    if (window.matchMedia('(max-width: 680px)').matches) {
      setMobileContext(false)
      setNavigationOpen(value => !value)
      if (navigationOpen) requestAnimationFrame(() => navigationToggle.current?.focus())
    } else {
      setNavigationOpen(false)
      setSidebarHidden(value => !value)
      requestAnimationFrame(() => {
        if (sidebarHidden) searchTrigger.current?.focus()
        else navigationToggle.current?.focus()
      })
    }
  }, [navigationOpen, sidebarHidden])

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.isComposing || event.defaultPrevented) return
      if (event.key === 'Escape') {
        if (navigationOpen) requestAnimationFrame(() => navigationToggle.current?.focus())
        if (mobileContext) requestAnimationFrame(() => contextToggle.current?.focus())
        setNavigationOpen(false)
        setMobileContext(false)
      }
      const command = workspaceShortcut(event)
      if (!command) return
      const activeDialog = document.querySelector('dialog[open]')
      if (activeDialog && !((searchOpen || switcherOpen) && (command === 'searchPages' || command === 'quickSwitch'))
        && !(shortcutsOpen && command === 'keyboardShortcuts')) return
      event.preventDefault()
      switch (command) {
        case 'searchPages':
          setSearchQuery('')
          setSwitcherOpen(false)
          setSearchOpen(!searchOpen)
          break
        case 'quickSwitch':
          setSearchOpen(false)
          setSearchQuery('')
          setSwitcherOpen(!switcherOpen)
          break
        case 'keyboardShortcuts':
          setShortcutsOpen(!shortcutsOpen)
          break
        case 'newPage':
          if (workspace) add()
          break
        case 'toggleNavigation':
          toggleNavigation()
          break
        case 'previousPage':
        case 'nextPage': {
          const step = command === 'previousPage' ? -1 : 1
          const history = pageHistory.current
          for (let index = history.position + step; index >= 0 && index < history.ids.length; index += step) {
            const id = history.ids[index]
            if (id !== page?.id && pages.some(item => item.id === id)) {
              history.position = index
              open(id)
              break
            }
          }
          break
        }
        case 'exportMarkdown':
          if (page) downloadPage(page)
          break
        case 'deletePage':
          if (page && page.cloudMirror?.state !== 'pending' && syncingPage !== page.id) setAction({ kind: 'delete', id: page.id })
          break
      }
    }
    window.addEventListener('keydown', shortcuts)
  return () => window.removeEventListener('keydown', shortcuts)
  }, [add, workspace, page, pages, open, navigationOpen, mobileContext, searchOpen, switcherOpen, shortcutsOpen, syncingPage, toggleNavigation])

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
    setTreeSyncKey(key => key + 1)
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
    setTreeSyncKey(key => key + 1)
    return report
  }

  async function exportAll() {
    try {
      await downloadWorkspace(pages)
      setNotice(t('exportStarted'))
    } catch {
      setNotice(t('exportFailed'))
    }
  }

  function mirrorError(failure: unknown) {
    if (failure instanceof MirrorFailure) return t(failure.code)
    if (failure instanceof AttachmentTransferError) return fileText(failure.code)
    if (failure instanceof VaultImportError) return importText(failure.code, failure.values)
    return t('mirrorFailed')
  }

  const syncLocalPage = useCallback(async (note: Page, automatic = false) => {
    if (mirrorRequest.current || !workspace || !mirrorEnabled || note.cloudMirror?.state === 'linked') return
    const controller = new AbortController()
    mirrorRequest.current = controller
    setSyncFailure(null)
    setSyncingPage(note.id)
    if (!automatic) setAction(null)
    let pending = note.cloudMirror
    try {
      if (!pending) {
        const notebook = workspace.mirrorNotebookId ?? crypto.randomUUID()
        const prepared = await prepareLocalMirror(note, controller.signal, localMirrorPlacement(workspace, note, notebook), automatic)
        await persistChange(state => state.pages.includes(note) && (!state.mirrorNotebookId || state.mirrorNotebookId === notebook)
          ? { ...state, mirrorNotebookId: notebook, pages: state.pages.map(item => item === note ? { ...item, cloudMirror: prepared } : item) } : state)
        pending = prepared
      }
      const attempt = pending.batch.importId
      controller.signal.throwIfAborted()
      const cloudId = await uploadLocalMirror(pending, note.files ?? [], controller.signal, automatic)
      controller.signal.throwIfAborted()
      await persistChange(state => {
        const existing = state.pages.find(item => item.id === note.id)
        if (existing?.cloudMirror?.state !== 'pending' || existing.cloudMirror.batch.importId !== attempt) return state
        return { ...state, pages: state.pages.map(item => item === existing
          ? { ...item, cloudMirror: { state: 'linked', pageId: cloudId } } : item) }
      })
      if (!automatic) setNotice(t('mirrorSynced'))
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof MirrorFailure && failure.code === 'mirrorAutomaticPaused') setPaidSyncEnded(true)
      if (failure instanceof MirrorRejected && pending) {
        const attempt = pending.batch.importId
        await persistChange(state => {
          const existing = state.pages.find(item => item.id === note.id)
          if (existing?.cloudMirror?.state !== 'pending' || existing.cloudMirror.batch.importId !== attempt) return state
          return { ...state, pages: state.pages.map(item => item === existing ? { ...item, cloudMirror: undefined } : item) }
        }).catch(() => undefined)
      }
      setSyncFailure({ id: note.id, failure })
    } finally {
      mirrorRequest.current = null
      if (!controller.signal.aborted) setSyncingPage(null)
    }
  }, [workspace, mirrorEnabled, persistChange, t])

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
    const layout = window.matchMedia('(max-width: 680px)')
    function closeMobileNavigation(event: MediaQueryListEvent) {
      if (!event.matches) setNavigationOpen(false)
    }
    layout.addEventListener('change', closeMobileNavigation)
  return () => layout.removeEventListener('change', closeMobileNavigation)
  }, [])

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
  const words = useMemo(
    () => deferredPage?.markdown.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0,
    [deferredPage],
  )

  const pageMenuItems = useMemo<DropdownMenuOption[]>(() => {
    if (!page) return []
    return [
      ...(!localReadOnly ? [{
        id: 'rename',
        icon: <Pencil size={16} aria-hidden="true" />,
        label: t('renamePage'),
        onClick: () => setTitleFocusRequest(value => value + 1),
      }] : []),
      ...(mirrorEnabled && !mirror ? [{
        id: 'mirror',
        icon: <Cloud size={16} aria-hidden="true" />,
        label: t('mirrorPage'),
        isDisabled: !!syncingPage || status === 'error' || status === 'conflict',
        onClick: () => setAction({ kind: 'mirror', id: page.id }),
      }] : []),
      {
        id: 'subpage',
        icon: <CornerDownRight size={16} aria-hidden="true" />,
        label: t('newSubpage'),
        onClick: () => add(page.id),
      },
      {
        id: 'move',
        icon: <MoveRight size={16} aria-hidden="true" />,
        label: t('movePage'),
        onClick: () => {
          setMoveTarget(page.parentId ?? '')
          setAction({ kind: 'move', id: page.id })
        },
      },
      {
        id: 'export',
        icon: <ArrowDownToLine size={16} aria-hidden="true" />,
        label: mirror?.state === 'linked' ? t('mirrorExportSnapshot') : t('exportMarkdown'),
        onClick: () => downloadPage(page),
      },
      ...(mirror?.state !== 'pending' && syncingPage !== page.id ? [
        { type: 'divider' as const },
        {
          id: 'delete',
          icon: <Trash2 size={16} aria-hidden="true" />,
          label: t('deletePage'),
          variant: 'destructive' as const,
          onClick: () => setAction({ kind: 'delete', id: page.id }),
        },
      ] : []),
    ]
  }, [add, localReadOnly, mirror, mirrorEnabled, page, status, syncingPage, t])

  return (
    <div className="workspace" data-context={contextOpen ? 'open' : 'closed'} data-navigation={sidebarHidden ? 'hidden' : undefined}>
      {navigationOpen && <button type="button" className="pane-scrim nav-scrim" aria-label={t('closeNavigation')} onClick={() => setNavigationOpen(false)} />}
      <aside className={`sidebar ${navigationOpen ? 'pane-open' : ''}`} aria-label={t('workspaceNavigation')} inert={mobileContext}>
        <div className="identity">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div><span className="brand-name">Lekhan</span><span className="workspace-name" title={workspaceName}>{workspaceName ?? t('personalWorkspace')}</span></div>
          <IconButton
            ref={navClose}
            className="close-sidebar"
            variant="ghost"
            size="sm"
            label={t('closeNavigation')}
            icon={<X size={18} />}
            onClick={() => { setNavigationOpen(false); requestAnimationFrame(() => navigationToggle.current?.focus()) }}
          />
        </div>
        <VStack gap={1.5} className="sidebar-actions">
          <Button
            ref={searchTrigger}
            type="button"
            variant="secondary"
            size="sm"
            width="100%"
            icon={<Search size={16} aria-hidden="true" />}
            endContent={<Kbd keys="mod+k" />}
            label={t('findPage')}
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setSearchOpen(true)}
          />
          <Item
            density="compact"
            startContent={<CalendarDays size={16} aria-hidden="true" />}
            label={t('today')}
            isDisabled={!workspace}
            onClick={openToday}
          />
        </VStack>
        <nav className="page-nav" aria-label={t('pages')}>
          {favorites.length > 0 && (
            <section className="nav-section" aria-label={t('favorites')}>
              <div className="nav-heading"><Text type="supporting" weight="semibold">{t('favorites')}</Text></div>
              {favorites.slice(0, favoriteLimit).map(item => (
                <Item
                  key={item.id}
                  density="compact"
                  startContent={<Star size={14} aria-hidden="true" />}
                  label={item.title}
                  labelLines={1}
                  isSelected={page?.id === item.id}
                  onClick={() => open(item.id)}
                />
              ))}
              {favorites.length > favoriteLimit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  label={t('showMoreFavorites')}
                  onClick={({ currentTarget }) => {
                    setFavoriteLimit(limit => limit + navigationBatch)
                    restoreListFocus(currentTarget, currentTarget.parentElement, '[role="button"], button', favoriteLimit)
                  }}
                />
              )}
            </section>
          )}
          <section className="nav-section" aria-label={t('allPages')}>
            <div className="nav-heading">
              <Text type="supporting" weight="semibold">{t('pages')}</Text>
              <IconButton
                variant="ghost"
                size="sm"
                label={t('addTopLevelPage')}
                tooltip={t('addTopLevelPage')}
                isDisabled={!workspace}
                icon={<Plus size={16} />}
                onClick={() => add()}
              />
            </div>
            <WorkspaceTree
              treeSyncKey={treeSyncKey}
              childPages={childPages}
              activePath={activePath}
              currentId={page?.id}
              collapsed={collapsed}
              onOpen={open}
              onAddInFolder={parentId => add(parentId)}
            />
            {workspace && pages.length === 0 && <Text type="supporting" color="secondary" className="nav-empty">{t('pagesEmpty')}</Text>}
          </section>
        </nav>
        <VStack gap={1.5} className="sidebar-footer">
          <Button
            type="button"
            variant="primary"
            size="md"
            width="100%"
            icon={<Plus size={18} aria-hidden="true" />}
            label={t('newPage')}
            isDisabled={!workspace}
            onClick={() => add()}
          />
          <div className="file-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              width="100%"
              icon={<ArrowUpFromLine size={15} aria-hidden="true" />}
              label={t('import')}
              isDisabled={!workspace}
              onClick={() => importInput.current?.click()}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              width="100%"
              icon={<ArrowDownToLine size={15} aria-hidden="true" />}
              label={t('export')}
              isDisabled={!pages.length}
              onClick={exportAll}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            width="100%"
            icon={<FolderClosed size={15} aria-hidden="true" />}
            label={importText('openVaultImport')}
            isDisabled={!workspace}
            onClick={() => {
              setNavigationOpen(false)
              setVaultOpen(true)
            }}
          />
          {typeof sidebarNotice === 'function' ? sidebarNotice(!workspace || status === 'saved') : sidebarNotice}
          <Popover
            isOpen={optionsOpen}
            onOpenChange={setOptionsOpen}
            placement="above"
            alignment="start"
            width={260}
            padding={2}
            presentation="adaptive"
            label={t('workspaceMenu')}
            content={
              <VStack
                gap={1}
                className="sidebar-popover-menu"
                onClick={event => {
                  const target = event.target instanceof Element ? event.target.closest('a[href], button, [role="button"]') : null
                  if (!target || target.matches('[role="combobox"], [role="option"]')) return
                  requestAnimationFrame(() => setOptionsOpen(false))
                }}
              >
                {typeof sidebarControls === 'function' ? sidebarControls(!workspace || status === 'saved') : sidebarControls}
                <Item
                  density="compact"
                  startContent={<Keyboard size={16} aria-hidden="true" />}
                  endContent={<Kbd keys="mod+/" />}
                  label={t('keyboardShortcuts')}
                  aria-keyshortcuts="Meta+/ Control+/"
                  onClick={() => setShortcutsOpen(true)}
                />
              </VStack>
            }
          >
            <Button
              ref={optionsTrigger}
              type="button"
              variant="secondary"
              size="sm"
              width="100%"
              icon={<SlidersHorizontal size={15} aria-hidden="true" />}
              endContent={<ChevronsUpDown size={14} className="sidebar-options-chevron" aria-hidden="true" />}
              label={t('workspaceMenu')}
            />
          </Popover>
        </VStack>
      </aside>

      <main className="main-panel" inert={navigationOpen || mobileContext}>
        <header className="topbar">
          <IconButton
            ref={navigationToggle}
            className="open-sidebar"
            variant="ghost"
            size="sm"
            label={t('openNavigation')}
            aria-expanded={navigationOpen}
            icon={<Menu size={21} />}
            onClick={toggleNavigation}
          />
          <Breadcrumbs label={t('breadcrumb')} variant="supporting" className="breadcrumbs">
            {trail.length === 0 ? (
              <BreadcrumbItem startIcon={<BookOpen size={15} aria-hidden="true" />} isCurrent>
                {t('workspace')}
              </BreadcrumbItem>
            ) : trail.map((item, index) => (
              <BreadcrumbItem
                key={item.id}
                startIcon={index === 0 ? <BookOpen size={15} aria-hidden="true" /> : undefined}
                isCurrent={index === trail.length - 1}
                onClick={index === trail.length - 1 ? undefined : isFolderPage(item) ? () => {
                  setCollapsed(previous => previous.filter(id => id !== item.id))
                  setTreeSyncKey(key => key + 1)
                  setSidebarHidden(false)
                  if (window.matchMedia('(max-width: 680px)').matches) setNavigationOpen(true)
                } : () => open(item.id)}
              >
                {item.title}
              </BreadcrumbItem>
            ))}
          </Breadcrumbs>
          <HStack gap={1.5} align="center" className="top-actions">
            <span className="save-status" data-status={status} role="status">
              {status === 'saved' ? <Check size={15} /> : status === 'saving' || status === 'loading'
                ? <LoaderCircle className="spin" size={15} /> : <CircleAlert size={15} />}
              <span>{t(statusMessage[status])}</span>
            </span>
            {page && (
              <>
                <IconButton
                  variant="ghost"
                  size="sm"
                  label={page.favorite ? t('removeFavorite') : t('addFavorite')}
                  tooltip={page.favorite ? t('removeFavorite') : t('addFavorite')}
                  aria-pressed={page.favorite}
                  icon={<Star size={18} fill={page.favorite ? 'currentColor' : 'none'} />}
                  onClick={() => change(state => updatePage(state, page.id, { favorite: !page.favorite }))}
                />
                {!localReadOnly && (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    label={aiText('writingAssistant')}
                    tooltip={aiText('writingAssistant')}
                    icon={<Sparkles size={17} />}
                    onClick={() => setAssistantOpen(true)}
                  />
                )}
                <DropdownMenu
                  placement="below"
                  alignment="end"
                  presentation="adaptive"
                  renderTrigger={props => (
                    <IconButton
                      {...props}
                      variant="ghost"
                      size="sm"
                      label={t('pageActions')}
                      tooltip={t('pageActions')}
                      icon={<MoreHorizontal size={20} />}
                    />
                  )}
                  items={pageMenuItems}
                />
              </>
            )}
            <IconButton
              ref={contextToggle}
              className="context-trigger"
              variant="ghost"
              size="sm"
              label={t('toggleContext')}
              tooltip={t('toggleContext')}
              isDisabled={!page}
              icon={<PanelRight size={18} />}
              onClick={toggleContext}
            />
          </HStack>
        </header>

        {workspace && (status === 'error' || status === 'conflict') && (
          <div className="save-warning" role="alert">
            <Banner
              status={status === 'error' ? 'error' : 'warning'}
              container="section"
              collapsible={false}
              title={status === 'conflict' ? storage ? desktopText('externalConflict') : t('saveConflict') : t('saveError')}
              endContent={
                <HStack gap={2}>
                  <Button size="sm" variant="secondary" label={t('exportEdits')} isDisabled={!pages.length} onClick={exportAll} />
                  {status === 'error'
                    ? <Button size="sm" variant="primary" label={t('retrySave')} onClick={() => void retry()} />
                    : <Button size="sm" variant="primary" label={t('openSavedCopy')} onClick={() => setAction({ kind: 'reload' })} />}
                </HStack>
              }
            />
          </div>
        )}
        {automaticMirror && !paidSyncEnded && syncFailure && syncFailure.id !== page?.id && (
          <div className="save-warning" role="alert">
            <Banner
              status="warning"
              container="section"
              collapsible={false}
              title={mirrorError(syncFailure.failure)}
              endContent={<Button size="sm" variant="secondary" label={t('mirrorRetryNotebook')} onClick={() => setSyncFailure(null)} />}
            />
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
              {syncFailure?.id === page.id && (
                <div role="alert" className="local-mirror-callout">
                  <Banner
                    status="warning"
                    collapsible={false}
                    title={mirrorError(syncFailure.failure)}
                    endContent={automaticMirror && !paidSyncEnded && !mirror
                      ? <Button size="sm" variant="secondary" label={t('mirrorRetryNotebook')} onClick={() => setSyncFailure(null)} />
                      : undefined}
                  />
                </div>
              )}
              {syncingPage === page.id && <Text type="supporting" role="status">{t(page.files?.length ? 'mirrorSyncingFiles' : 'mirrorSyncing')}</Text>}
              {mirror?.state === 'pending' && syncingPage !== page.id && (
                <div className="local-mirror-callout">
                  <Banner
                    status="info"
                    collapsible={false}
                    title={t('mirrorPending')}
                    endContent={<Button size="sm" variant="secondary" label={t('mirrorRetry')} isDisabled={!mirrorEnabled || !!syncingPage || status !== 'saved'} onClick={() => void syncLocalPage(page)} />}
                  />
                </div>
              )}
              {mirror?.state === 'linked' ? (
                <div className="local-mirror-callout">
                  <Banner
                    status="success"
                    collapsible={false}
                    title={t('mirrorLinked')}
                    endContent={
                      <Button
                        size="sm"
                        variant="primary"
                        href={'/page/' + mirror.pageId}
                        icon={<Cloud size={16} aria-hidden="true" />}
                        label={t('mirrorOpen')}
                        onClick={event => {
                          if (!openCloudPage || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                          event.preventDefault()
                          openCloudPage(mirror.pageId)
                        }}
                      />
                    }
                  />
                </div>
              ) : <PageEditor
                markdown={page.markdown}
                pageId={page.id}
                choices={choices}
                editable={!localReadOnly}
                assistant={editorAssistant}
                onChange={markdown => { if (!localReadOnly) change(state => updatePage(state, page.id, { markdown })) }}
                onOpenLink={handleLink}
                onOpenAttachment={href => {
                  const link = attachmentReference(href)
                  const file = link && page.files?.find(item => item.id === link.id)
                  if (!file) return false
                  downloadAttachment(file)
                  return true
                }}
              />}
            </article>
          </div>
        ) : (
          <div className="workspace-empty">
            <EmptyState
              headingLevel={1}
              icon={<NotebookPen size={26} />}
              title={!workspace && status === 'error' ? t('workspaceUnavailable') : workspace ? t('startWithPage') : t('openingYourWorkspace')}
              actions={workspace
                ? <Button variant="primary" size="md" icon={<Plus size={17} />} label={t('newPage')} onClick={() => add()} />
                : status === 'error'
                  ? <Button variant="primary" size="md" label={t('tryAgain')} onClick={() => void reload()} />
                  : <LoaderCircle className="spin" size={22} aria-hidden="true" />}
            />
          </div>
        )}
        <footer className="editor-footer">
          <Text type="supporting" color="secondary">{page ? editorText('wordCount', { count: words }) : 'Lekhan'}</Text>
          {page && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Search size={13} aria-hidden="true" />}
              label={editorText('quickSearch')}
              aria-label={t('findPage')}
              onClick={() => setSearchOpen(true)}
            />
          )}
        </footer>
      </main>

      {mobileContext && <button type="button" className="pane-scrim context-scrim" aria-label={t('closeContext')} onClick={() => setMobileContext(false)} />}
      <aside className={`context-panel ${mobileContext ? 'pane-open' : ''}`} aria-label={t('pageContext')}>
        <div className="context-header">
          <PanelRight size={17} aria-hidden="true" />
          <h2>{t('pageContext')}</h2>
          <IconButton
            ref={contextClose}
            variant="ghost"
            size="sm"
            label={t('closeContext')}
            tooltip={t('closeContext')}
            icon={<X size={16} />}
            onClick={() => {
              setContextOpen(false)
              setMobileContext(false)
              requestAnimationFrame(() => contextToggle.current?.focus())
            }}
          />
        </div>
        {page && (
          <div className="context-body">
            {pageAttachments?.(page, localReadOnly || status !== 'saved' ? undefined : markdown => {
              change(state => {
                const current = state.pages.find(note => note.id === page.id)
                return current ? updatePage(state, current.id, { markdown: [current.markdown, markdown].filter(Boolean).join('\n\n') }) : state
              })
            })}
            {!!page.files?.length && <section className="context-section">
              <h3><Paperclip size={16} aria-hidden="true" /> {desktopText('attachments')}</h3>
              <VStack gap={0.5} className="context-file-list">
                {page.files.map(file => (
                  <Item
                    key={file.id}
                    density="compact"
                    startContent={<ArrowDownToLine size={14} aria-hidden="true" />}
                    label={file.filename}
                    labelLines={1}
                    onClick={() => downloadAttachment(file)}
                  />
                ))}
              </VStack>
              {automaticMirror && !mirror && hasUnsupportedMirrorFile(page) && <Text type="supporting" color="secondary">{t('filesPreventSync')}</Text>}
            </section>}
            {page.properties && Object.keys(page.properties).length > 0 && (
              <section className="context-section">
                <h3><FileText size={16} /> {t('properties')}</h3>
                <dl className="page-properties">
                  {Object.entries(page.properties).map(([name, value]) => <div key={name}>
                    <dt>{name}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                  </div>)}
                </dl>
              </section>
            )}
            {tags.length > 0 && (
              <section className="context-section">
                <h3><span aria-hidden="true">#</span> {t('tags')}</h3>
                <HStack gap={1.5} wrap="wrap" className="page-tags">
                  {tags.map(tag => (
                    <Button
                      key={tag}
                      type="button"
                      variant="secondary"
                      size="sm"
                      label={`#${tag}`}
                      onClick={() => {
                        setMobileContext(false)
                        setSearchQuery('#' + tag)
                        setSearchOpen(true)
                      }}
                    />
                  ))}
                </HStack>
              </section>
            )}
            <section className="context-section">
              <h3><List size={16} /> {t('onThisPage')}</h3>
              {headings.length ? (
                <ol className="outline-list">
                  {headings.map((heading, index) => (
                    <li key={`${heading.text}-${index}`} style={{ paddingInlineStart: Math.max(0, heading.level - 2) * 10 }}>
                      <Item density="compact" label={heading.text} labelLines={1} onClick={() => jumpToHeading(index)} />
                    </li>
                  ))}
                </ol>
              ) : <Text type="supporting" color="secondary" className="context-empty">{t('headingsEmpty')}</Text>}
            </section>
            <BacklinksSection key={'backlinks:' + page.id} links={links} onOpen={open} />
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
      {vaultOpen && <VaultImportDialog onClose={() => setVaultOpen(false)} onImport={importVault} includeAttachments={!storage} saveStatus={status} />}
      {shortcutsOpen && <WorkspaceShortcutHelp onClose={() => setShortcutsOpen(false)} />}
      {switcherOpen && <SearchDialog titleOnly pages={pages} onOpen={open} onClose={() => setSwitcherOpen(false)} />}
      {searchOpen && <SearchDialog pages={pages} initialQuery={searchQuery} onOpen={open} cloudSubject={cloudSearchSubject}
        onOpenCloud={openCloudPage ? id => {
          setSearchOpen(false)
          setSearchQuery('')
          openCloudPage(id)
        } : undefined}
        onClose={() => { setSearchOpen(false); setSearchQuery('') }} />}
      {action?.kind === 'move' && actionPage && (
        <AstryxDialog isOpen onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} purpose="form" width={440} padding={0}>
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const parentId = moveTarget || null
            change(state => updatePage(state, actionPage.id, { parentId }))
            if (parentId) {
              setCollapsed(previous => previous.filter(id => id !== parentId))
              setTreeSyncKey(key => key + 1)
            }
            setAction(null)
          }}>
            <Layout
              header={<DialogHeader title={t('movePage')} onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} />}
              content={
                <LayoutContent>
                  <Selector
                    label={t('destination')}
                    value={moveTarget}
                    onChange={setMoveTarget}
                    width="100%"
                    options={[
                      { value: '', label: t('topLevel') },
                      ...pages.filter(item => !descendants.some(child => child.id === item.id)).map(item => ({
                        value: item.id,
                        label: pagePath(pages, item.id).map(parent => parent.title).join(' / '),
                      })),
                    ]}
                  />
                </LayoutContent>
              }
              footer={
                <LayoutFooter hasDivider>
                  <HStack gap={2} justify="end">
                    <Button type="button" variant="secondary" label={t('cancel')} onClick={() => setAction(null)} />
                    <Button type="submit" variant="primary" label={t('movePage')} />
                  </HStack>
                </LayoutFooter>
              }
            />
          </form>
        </AstryxDialog>
      )}
      {action?.kind === 'delete' && actionPage && (
        deletingPendingPage ? (
          <AstryxDialog isOpen onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} width={440} padding={0}>
            <Layout
              header={<DialogHeader title={t('deletePageTitle', { title: actionPage.title })} onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} />}
              content={<LayoutContent><Text>{t('mirrorDeletePending')}</Text></LayoutContent>}
              footer={
                <LayoutFooter hasDivider>
                  <HStack gap={2} justify="end">
                    <Button type="button" variant="secondary" label={t('cancel')} onClick={() => setAction(null)} />
                  </HStack>
                </LayoutFooter>
              }
            />
          </AstryxDialog>
        ) : (
          <AlertDialog
            isOpen
            onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }}
            title={t('deletePageTitle', { title: actionPage.title })}
            description={actionPage.cloudMirror?.state === 'linked' && descendants.length === 1
              ? t('mirrorDeleteLocal')
              : `${descendants.length > 1 ? t('deleteNested', { count: descendants.length - 1 }) : t('deleteFromWorkspace')} ${t('cannotUndo')}`}
            cancelLabel={t('cancel')}
            actionLabel={t(descendants.length > 1 ? 'deletePages' : 'deletePage')}
            actionVariant="destructive"
            onAction={() => {
              change(state => deletePage(state, actionPage.id))
              setAction(null)
            }}
          />
        )
      )}
      {action?.kind === 'mirror' && actionPage && (
        <AstryxDialog isOpen onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} width={440} padding={0}>
          <Layout
            header={<DialogHeader title={t('mirrorPageTitle', { title: actionPage.title })} onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} />}
            content={<LayoutContent><Text>{t(actionPage.files?.length ? 'mirrorConfirmFiles' : 'mirrorConfirm')}</Text></LayoutContent>}
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2} justify="end">
                  <Button type="button" variant="secondary" label={t('cancel')} onClick={() => setAction(null)} />
                  <Button type="button" variant="primary" label={t('mirrorPage')} onClick={() => void syncLocalPage(actionPage)} />
                </HStack>
              </LayoutFooter>
            }
          />
        </AstryxDialog>
      )}
      {action?.kind === 'link' && (
        <AstryxDialog isOpen onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} width={440} padding={0}>
          <Layout
            header={<DialogHeader title={t('linkedAs', { target: action.target })} onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} />}
            content={<LayoutContent><Text>{t('unresolvedLinkHelp')}</Text></LayoutContent>}
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2} justify="end">
                  <Button type="button" variant="secondary" label={t('searchPages')} onClick={() => { setAction(null); setSearchOpen(true) }} />
                  <Button type="button" variant="primary" label={t('createPage')} onClick={() => createLinkedPage(action.target)} />
                </HStack>
              </LayoutFooter>
            }
          />
        </AstryxDialog>
      )}
      {action?.kind === 'reload' && (
        <AstryxDialog isOpen onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} width={440} padding={0}>
          <Layout
            header={<DialogHeader title={t('openSavedCopyTitle')} onOpenChange={nextOpen => { if (!nextOpen) setAction(null) }} />}
            content={<LayoutContent><Text>{storage ? desktopText('externalReload') : t('openSavedCopyHelp')}</Text></LayoutContent>}
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2} justify="end">
                  <Button type="button" variant="secondary" label={t('cancel')} onClick={() => setAction(null)} />
                  <Button type="button" variant="primary" label={t('openSavedCopy')} onClick={() => { setAction(null); void reload() }} />
                </HStack>
              </LayoutFooter>
            }
          />
        </AstryxDialog>
      )}
      {notice && (
        <div className="notice visible" aria-live="polite">
          <Banner
            status="info"
            elevation="high"
            title={notice}
            isDismissable
            dismissLabel={t('dismissMessage')}
            onDismiss={() => setNotice('')}
          />
        </div>
      )}
    </div>
  )
}

const emptyPages: Page[] = []
const emptyTrail: readonly PageLocation[] = []

interface WorkspaceTreeProps {
  treeSyncKey: number
  childPages: ReadonlyMap<string | null, readonly PageLocation[]>
  activePath: ReadonlyMap<string | null, string>
  currentId?: string
  collapsed: string[]
  onOpen: (id: string) => void
  onAddInFolder: (parentId: string) => void
}

const WorkspaceTree = memo(function WorkspaceTree({
  treeSyncKey, childPages, activePath, currentId, collapsed, onOpen, onAddInFolder,
}: WorkspaceTreeProps) {
  const t = useTranslations('app-shell')
  const [limits, setLimits] = useState<Record<string, number>>({})

  const treeItems = useMemo(() => {
    function buildBranch(parentId: string | null): TreeListItemData[] {
      const children = childPages.get(parentId)
      if (!children?.length) return []
      const branchKey = parentId ?? '__root__'
      const limit = limits[branchKey] ?? navigationBatch
      const shown = children.slice(0, limit)
      const active = children.find(page => page.id === activePath.get(parentId))
      if (active && !shown.includes(active)) shown.push(active)

      const items: TreeListItemData[] = shown.map(page => {
        const isFolder = isFolderPage(page)
        const hasChildren = childPages.has(page.id)
        return {
          id: page.id,
          label: page.title,
          startContent: isFolder || hasChildren
            ? <FolderClosed size={16} aria-hidden="true" />
            : <FileText size={16} aria-hidden="true" />,
          endContent: isFolder ? (
            <IconButton
              size="sm"
              variant="ghost"
              label={t('addPageInFolder', { title: page.title })}
              tooltip={t('addPageInFolder', { title: page.title })}
              icon={<Plus size={14} aria-hidden="true" />}
              onClick={event => {
                event.stopPropagation()
                onAddInFolder(page.id)
              }}
            />
          ) : undefined,
          children: hasChildren ? buildBranch(page.id) : undefined,
          onClick: isFolder ? undefined : () => onOpen(page.id),
          isSelected: !isFolder && currentId === page.id,
          isExpanded: !collapsed.includes(page.id),
        }
      })

      if (children.length > shown.length) {
        items.push({
          id: `__more__:${branchKey}`,
          label: t('showMorePages'),
          onClick: () => setLimits(previous => ({ ...previous, [branchKey]: limit + navigationBatch })),
        })
      }
      return items
    }

    return buildBranch(null)
  }, [activePath, childPages, collapsed, currentId, limits, onAddInFolder, onOpen, t])

  if (!treeItems.length) return null

  return (
    <TreeList
      key={treeSyncKey}
      items={treeItems}
      density="compact"
      variant="lineGuides"
      aria-label={t('allPages')}
    />
  )
})

const BacklinksSection = memo(function BacklinksSection({ links, onOpen }: { links: ReturnType<typeof getBacklinks>; onOpen: (id: string) => void }) {
  const t = useTranslations('app-shell')
  const [limit, setLimit] = useState(backlinkBatch)
  return <section className="context-section">
    <h3><Link2 size={16} aria-hidden="true" /> {t('backlinks')} <Badge label={links.length} /></h3>
    {links.length ? links.slice(0, limit).map(({ page, excerpt }) => (
      <Item
        key={page.id}
        density="compact"
        startContent={<FileText size={15} aria-hidden="true" />}
        label={page.title}
        description={excerpt || undefined}
        descriptionLines={2}
        endContent={<ChevronRight size={13} aria-hidden="true" />}
        onClick={() => onOpen(page.id)}
      />
    )) : <Text type="supporting" color="secondary" className="context-empty">{t('backlinksEmpty')}</Text>}
    {links.length > limit && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        label={t('showMoreBacklinks')}
        onClick={({ currentTarget }) => {
          setLimit(previous => previous + backlinkBatch)
          restoreListFocus(currentTarget, currentTarget.parentElement, '[role="button"], button', limit)
        }}
      />
    )}
  </section>
})
