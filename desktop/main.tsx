import { invoke } from '@tauri-apps/api/core'
import { Cloud, Cpu, FolderOpen } from 'lucide-react'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import '@/app/globals.css'
import './desktop.css'
import LocaleSelect from '@/components/locale-select'
import WorkspaceApp from '@/components/workspace-app'
import { downloadWorkspace } from '@/lib/downloads'
import { getCatalog } from '@/lib/i18n/catalog'
import { localeDirection, resolveLocale, type Locale } from '@/lib/i18n/locales'
import { loadWorkspace } from '@/lib/storage'
import type { Page } from '@/lib/types'
import { vaultStorage, type VaultAsset, type VaultHandle } from './vault-storage'
import AttachmentPanel from './attachment-panel'
import ModelLibrary from './model-library'
import { sendToLocalModel, type LocalLibrary } from './local-models'

type DesktopLocale = { locale: Locale; messages: Awaited<ReturnType<typeof getCatalog>> }
const languageKey = 'lekhan:desktop:language'
const selectedModelKey = 'lekhan:desktop:local-model'

function DesktopWriter({ selectLanguage }: { selectLanguage: (locale: Locale) => Promise<void> }) {
  const t = useTranslations('desktop')
  const [handle, setHandle] = useState<VaultHandle | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [choosing, setChoosing] = useState(false)
  const [vaultFailed, setVaultFailed] = useState(false)
  const [recoveredVault, setRecoveredVault] = useState<string | null>(null)
  const [launchFailed, setLaunchFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [preview, setPreview] = useState<Page[]>([])
  const [library, setLibrary] = useState<LocalLibrary>()
  const libraryRead = useRef(0)
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(selectedModelKey))
  const [catalog, setCatalog] = useState<{ token: string; paths: Map<string, string>; assets: VaultAsset[] }>()
  const storage = useMemo(() => handle && vaultStorage(handle, {
    recovered: () => setRecoveredVault(handle.token),
    files: (paths, assets) => setCatalog(previous => ({
      token: handle.token, paths, assets: assets ?? (previous?.token === handle.token ? previous.assets : []),
    })),
  }), [handle])
  const refreshLibrary = useCallback(async () => {
    const revision = ++libraryRead.current
    try {
      const next = await invoke<LocalLibrary>('list_local_models')
      if (libraryRead.current === revision) setLibrary(next)
      return next
    } catch {
      return undefined
    }
  }, [])
  const model = library?.runtimeAvailable ? library.models.find(item => item.id === selectedModel) : undefined
  const localModel = useMemo(() => model && { label: model.label, send: (options: Parameters<typeof sendToLocalModel>[1]) => sendToLocalModel(model.id, options) }, [model])

  useEffect(() => {
    let live = true
    void invoke<VaultHandle | null>('restore_vault')
      .then(value => { if (live) setHandle(value) })
      .catch(() => { if (live) setVaultFailed(true) })
      .finally(() => { if (live) setRestoring(false) })
    void loadWorkspace('desktop').then(value => { if (live && value) setPreview(value.pages) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    const revision = ++libraryRead.current
    void invoke<LocalLibrary>('list_local_models').then(next => {
      if (live && libraryRead.current === revision) setLibrary(next)
    }).catch(() => undefined)
    return () => { live = false }
  }, [])

  function selectModel(id: string | null) {
    if (id) localStorage.setItem(selectedModelKey, id)
    else localStorage.removeItem(selectedModelKey)
    setSelectedModel(id)
  }

  async function selectVault() {
    setChoosing(true)
    setVaultFailed(false)
    try {
      const selected = await invoke<VaultHandle | null>('choose_vault')
      if (selected) setHandle(selected)
    } catch {
      setVaultFailed(true)
    } finally {
      setChoosing(false)
    }
  }

  async function openCloud() {
    setOpening(true)
    setLaunchFailed(false)
    try {
      await invoke('open_cloud_workspace')
    } catch {
      setLaunchFailed(true)
    } finally {
      setOpening(false)
    }
  }

  const commonControls = <>
    <LocaleSelect onSelect={selectLanguage} />
    <button type="button" className="nav-action" onClick={() => {
      setModelLibraryOpen(true)
      void refreshLibrary()
    }}><Cpu size={15} aria-hidden="true" /> {t('modelLibrary')}</button>
    <button type="button" className="nav-action account-link" disabled={opening} onClick={() => void openCloud()}>
      <Cloud size={15} /> {t('cloudWorkspace')}
    </button>
    {launchFailed && <p className="locale-error desktop-cloud-error" role="alert">{t('cloudFailed')}</p>}
    {preview.length > 0 && <button type="button" className="nav-action" onClick={() => downloadWorkspace(preview)}>{t('exportPreview')}</button>}
  </>
  const libraryDialog = modelLibraryOpen && <ModelLibrary library={library} selected={selectedModel} onSelect={selectModel}
    refresh={refreshLibrary} onClose={() => setModelLibraryOpen(false)} />
  const failure = vaultFailed && <p className="locale-error desktop-cloud-error" role="alert">{t('openFailed')}</p>

  if (handle && storage) return <div className="desktop-writer" inert={choosing}>
    <WorkspaceApp key={handle.token} storageScope="desktop" storage={storage} workspaceName={handle.label} localModel={localModel}
      pageAttachments={(page, insert) => <AttachmentPanel key={page.id} token={handle.token} page={page}
        path={catalog?.token === handle.token ? catalog.paths.get(page.id) ?? '' : ''}
        assets={catalog?.token === handle.token ? catalog.assets : []} onAttach={storage.rememberAttachment} onInsert={insert} />}
      sidebarControls={canSwitch => <>
        <button type="button" className="nav-action" disabled={!canSwitch || choosing} onClick={() => void selectVault()}>
          <FolderOpen size={15} /> {t('swapVault')}
        </button>
        {failure}
        {recoveredVault === handle.token && <p className="desktop-recovery-notice" role="status">{t('recoveredDrafts')}</p>}
        {commonControls}
      </>} />
    {libraryDialog}
  </div>

  return <main className="desktop-vault">
    <div className="desktop-vault-content">
      <span className="brand-mark" aria-hidden="true">L</span>
      <h1>{t('vaultTitle')}</h1>
      <p>{t('vaultBody')}</p>
      <button type="button" className="primary-button" disabled={restoring || choosing} onClick={() => void selectVault()}>
        <FolderOpen size={18} /> {t('chooseVault')}
      </button>
      {failure}
      <div className="desktop-vault-controls">{commonControls}</div>
    </div>
    {libraryDialog}
  </main>
}

function Desktop({ initial }: { initial: DesktopLocale }) {
  const [{ locale, messages }, setLocale] = useState(initial)
  async function selectLanguage(language: Locale) {
    const next = await getCatalog(language)
    localStorage.setItem(languageKey, language)
    document.documentElement.lang = language
    document.documentElement.dir = localeDirection(language)
    setLocale({ locale: language, messages: next })
  }

  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <DesktopWriter selectLanguage={selectLanguage} />
  </NextIntlClientProvider>
}

const locale = resolveLocale(localStorage.getItem(languageKey) ?? navigator.language.split('-')[0])
document.documentElement.lang = locale
document.documentElement.dir = localeDirection(locale)
const messages = await getCatalog(locale)
createRoot(document.getElementById('root')!).render(<Desktop initial={{ locale, messages }} />)
