import { invoke } from '@tauri-apps/api/core'
import { Cloud, Cpu, FolderOpen, Settings2 } from 'lucide-react'
import { NextIntlClientProvider, useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import '@/app/globals.css'
import '@/lib/lekhan.css'
import '@/components/settings/settings.css'
import './desktop.css'
import { Theme } from '@astryxdesign/core/theme'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Item } from '@astryxdesign/core/Item'
import { lekhanTheme } from '@/lib/lekhan'
import { useResolvedEditorTheme } from '@/components/astryx-provider'
import LocaleSelect from '@/components/locale-select'
import WorkspaceApp from '@/components/workspace-app'
import { SettingsDialog } from '@/components/settings/settings-content'
import { EditorAppearance } from '@/components/settings/appearance-settings'
import { downloadWorkspace } from '@/lib/downloads'
import { getCatalog } from '@/lib/i18n/catalog'
import { localeDirection, resolveLocale, type Locale } from '@/lib/i18n/locales'
import { loadWorkspace } from '@/lib/storage'
import type { Page } from '@/lib/types'
import { vaultStorage, type VaultAsset, type VaultHandle } from './vault-storage'
import AttachmentPanel from './attachment-panel'
import ModelLibrary from '@/components/settings/model-library'
import { sendToLocalModel, type LocalLibrary } from './local-models'
import { desktopProviderTransport } from './provider-transport'
import { DesktopUpdateControls, DesktopUpdateProgress, useDesktopUpdates } from './update-controls'

type DesktopLocale = { locale: Locale; messages: Awaited<ReturnType<typeof getCatalog>> }
const languageKey = 'lekhan:desktop:language'
const selectedModelKey = 'lekhan:desktop:local-model'

function DesktopWriter({ selectLanguage }: { selectLanguage: (locale: Locale) => Promise<void> }) {
  const t = useTranslations('desktop')
  const settings = useTranslations('settings')
  const updates = useDesktopUpdates()
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const localModels = useMemo(() => library?.runtimeAvailable ? library.models.map(model => ({
    id: model.id, label: model.label, send: (options: Parameters<typeof sendToLocalModel>[1]) => sendToLocalModel(model.id, options),
  })) : [], [library])
  const localModel = localModels.find(item => item.id === selectedModel)

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

  const commonControls = (canInstall: boolean) => <>
    <LocaleSelect onSelect={selectLanguage} />
    <Item
      density="compact"
      startContent={<Cpu size={15} aria-hidden="true" />}
      label={t('modelLibrary')}
      onClick={() => {
        setModelLibraryOpen(true)
        void refreshLibrary()
      }}
    />
    <Item
      density="compact"
      startContent={<Settings2 size={15} aria-hidden="true" />}
      label={settings('title')}
      onClick={() => {
        setSettingsOpen(true)
        void refreshLibrary()
      }}
    />
    <Item
      density="compact"
      startContent={<Cloud size={15} aria-hidden="true" />}
      label={t('cloudWorkspace')}
      isDisabled={opening}
      onClick={() => void openCloud()}
    />
    {launchFailed && <p className="locale-error desktop-cloud-error" role="alert">{t('cloudFailed')}</p>}
    <DesktopUpdateControls updates={updates} canInstall={canInstall} />
    {preview.length > 0 && <Item density="compact" label={t('exportPreview')} onClick={() => downloadWorkspace(preview)} />}
  </>
  const libraryDialog = modelLibraryOpen && <ModelLibrary library={library} selected={selectedModel} onSelect={selectModel}
    refresh={refreshLibrary} onClose={() => setModelLibraryOpen(false)} />
  const settingsDialog = settingsOpen && <SettingsDialog scope="desktop" workspace={handle?.label ?? settings('localWorkspace')}
    general={<LocaleSelect onSelect={selectLanguage} />} localModel={localModel} localModels={localModels} transport={desktopProviderTransport}
    modelLibrary={<ModelLibrary library={library} selected={selectedModel} onSelect={selectModel} refresh={refreshLibrary} />}
    onClose={() => setSettingsOpen(false)} />
  const failure = vaultFailed && <p className="locale-error desktop-cloud-error" role="alert">{t('openFailed')}</p>

  if (handle && storage) return <div className="desktop-writer" inert={choosing}>
    <WorkspaceApp key={handle.token} storageScope="desktop" storage={storage} workspaceName={handle.label}
      localModel={localModel} localModels={localModels} providerTransport={desktopProviderTransport}
      pageAttachments={(page, insert) => <AttachmentPanel key={page.id} token={handle.token} page={page}
        path={catalog?.token === handle.token ? catalog.paths.get(page.id) ?? '' : ''}
        assets={catalog?.token === handle.token ? catalog.assets : []} onAttach={storage.rememberAttachment} onInsert={insert} />}
      sidebarNotice={recoveredVault === handle.token || failure ? <>
        {failure}
        {recoveredVault === handle.token && <div role="status"><Banner status="info" collapsible={false} title={t('recoveredDrafts')} /></div>}
      </> : undefined}
      sidebarControls={canSwitch => <>
        <Item
          density="compact"
          startContent={<FolderOpen size={15} aria-hidden="true" />}
          label={t('swapVault')}
          isDisabled={!canSwitch || choosing}
          onClick={() => void selectVault()}
        />
        {commonControls(canSwitch && !choosing)}
      </>} />
    {libraryDialog}
    {settingsDialog}
    <DesktopUpdateProgress installing={updates.installing} />
  </div>

  return <main className="desktop-vault">
    <div className="desktop-vault-content">
      <span className="brand-mark" aria-hidden="true">L</span>
      <h1>{t('vaultTitle')}</h1>
      <p>{t('vaultBody')}</p>
      <Button
        type="button"
        variant="primary"
        icon={<FolderOpen size={18} aria-hidden="true" />}
        isDisabled={restoring || choosing}
        label={t('chooseVault')}
        onClick={() => void selectVault()}
      />
      {failure}
      <div className="desktop-vault-controls">{commonControls(!restoring && !choosing)}</div>
    </div>
    {libraryDialog}
    {settingsDialog}
    <DesktopUpdateProgress installing={updates.installing} />
  </main>
}

function Desktop({ initial }: { initial: DesktopLocale }) {
  const [{ locale, messages }, setLocale] = useState(initial)
  const mode = useResolvedEditorTheme()
  async function selectLanguage(language: Locale) {
    const next = await getCatalog(language)
    localStorage.setItem(languageKey, language)
    document.documentElement.lang = language
    document.documentElement.dir = localeDirection(language)
    setLocale({ locale: language, messages: next })
  }

  return <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
    <Theme theme={lekhanTheme} mode={mode}>
      <EditorAppearance />
      <DesktopWriter selectLanguage={selectLanguage} />
    </Theme>
  </NextIntlClientProvider>
}

const locale = resolveLocale(localStorage.getItem(languageKey) ?? navigator.language.split('-')[0])
document.documentElement.lang = locale
document.documentElement.dir = localeDirection(locale)
const messages = await getCatalog(locale)
createRoot(document.getElementById('root')!).render(<Desktop initial={{ locale, messages }} />)
