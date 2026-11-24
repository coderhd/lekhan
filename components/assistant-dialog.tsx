'use client'

import { ArrowUpRight, Check, Copy, LockKeyhole, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Page } from '@/lib/types'
import { probeLocalProviders, streamChat, testProviderConnection, type ChatMessage, type ChatOptions, type LocalProviderProbe, type ProviderTransport } from '@/lib/ai/client'
import { allowsProviderEndpoint, endpointFor, FREE_PRESETS, PROVIDERS, providerConnectionKind, providerDefinition, type ProviderConfig, type ProviderId } from '@/lib/ai/provider-registry'
import { editorActionMessages, translationLanguages, type EditorAction } from '@/lib/ai/editor-actions'
import { runFallback } from '@/lib/ai/fallback'
import { createProviderVault, unlockProviderVault } from '@/lib/ai/vault'
import { encryptedVaultRevision, providerVaultLimit, readAccountVault, validProviderEnvelope, writeAccountVault, ProviderVaultConflict, vaultRevisionPattern, type CloudProviderVault } from '@/lib/ai/vault-sync'
import { track } from '@/lib/analytics'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { Dialog } from './workspace-dialogs'
import BotBarModelPicker, { type ModelTelemetry } from './editor/bot-bar-model-picker'
import FallbackModelSettings from './editor/fallback-model-settings'
import LocalProviderDiscovery from './editor/local-provider-discovery'
import ProviderCatalog from './settings/provider-catalog'

const defaultVaultKey = 'lekhan:provider-vault:v1'
const newConnection = (): ProviderConfig => ({ id: crypto.randomUUID(), provider: 'ollama', model: '' })
type VaultSession = Awaited<ReturnType<typeof createProviderVault>>
export type LocalAssistantModel = { id?: string; label: string; send: (options: ChatOptions) => ReturnType<typeof streamChat> }
type EditorRequest = { action: EditorAction; selection: { text: string; apply: (result: string, append: boolean) => boolean } }
const connectionKinds = ['local', 'free', 'cloud'] as const
type ConnectionKind = typeof connectionKinds[number]

function newDraftFor(kind: ConnectionKind) {
  const preset = kind === 'free' ? FREE_PRESETS[0] : null
  return { ...newConnection(), provider: preset?.provider ?? (kind === 'cloud' ? 'openai' : 'ollama'), model: preset?.model ?? '' }
}

function modelLabel(config: ProviderConfig) {
  let destination = PROVIDERS[config.provider].label
  if (config.provider === 'custom' || config.provider === 'qwen') {
    try { destination = new URL(endpointFor(config)).host } catch { /* The connection will need repair. */ }
  }
  return [config.label !== destination ? config.label : undefined, destination, config.model].filter(Boolean).join(' · ')
}

function readVault(vaultKey: string) {
  try { return localStorage.getItem(vaultKey) } catch { return null }
}

async function storeVault(vaultKey: string, previous: string | null, encrypted: string, signal: AbortSignal) {
  const write = () => {
    signal.throwIfAborted()
    if (localStorage.getItem(vaultKey) !== previous) {
      throw new Error('Provider connections changed in another tab. Close and reopen the assistant before saving.')
    }
    localStorage.setItem(vaultKey, encrypted)
  }
  if (navigator.locks) await navigator.locks.request(vaultKey, { signal }, write)
  else write()
}

export default function AssistantDialog({ page, storageScope, onInsert, onClose, localModel, localModels, editorRequest, settingsPanel, transport }: {
  storageScope: string
  localModel?: LocalAssistantModel; localModels?: readonly LocalAssistantModel[]
  transport?: ProviderTransport
} & ({ page: Page; onInsert: (text: string) => void; onClose: () => void; editorRequest?: never; settingsPanel?: never }
  | { editorRequest: EditorRequest; onClose: () => void; page?: never; onInsert?: never; settingsPanel?: never }
  | { settingsPanel: 'models' | 'privacy'; page?: never; onInsert?: never; onClose?: never; editorRequest?: never })) {
  const desktopText = useTranslations('desktop')
  const text = useTranslations('editor-ai')
  const settingsText = useTranslations('settings')
  const locale = useLocale()
  const vaultKey = storageScope === 'personal' ? defaultVaultKey : defaultVaultKey + ':' + storageScope
  const account = storageScope.startsWith('account:') ? storageScope.slice('account:'.length) : null
  const baseKey = vaultKey + ':cloud-revision'
  const activeKey = vaultKey + ':active-connection'
  const [accountVault, setAccountVault] = useState<CloudProviderVault | null | 'unavailable'>()
  const [cloudBase, setCloudBase] = useState(() => {
    const revision = readVault(baseKey)
    return revision && vaultRevisionPattern.test(revision) ? revision : null
  })
  const [restoreAccount, setRestoreAccount] = useState(false)
  const [importedVault, setImportedVault] = useState<string>()
  const [envelope, setEnvelope] = useState(() => readVault(vaultKey))
  const [vault, setVault] = useState<VaultSession | null>(null)
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [active, setActive] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [tab, setTab] = useState<'chat' | 'providers' | 'local'>(!settingsPanel && localModel ? 'local' : 'providers')
  const [draft, setDraft] = useState(newConnection)
  const [connectionKind, setConnectionKind] = useState<ConnectionKind>('local')
  const [models, setModels] = useState<string[]>([])
  const [localProbes, setLocalProbes] = useState<LocalProviderProbe[]>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [sharePage, setSharePage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [localId, setLocalId] = useState(localModel?.id ?? '')
  const [telemetry, setTelemetry] = useState<{ key: string; result: ModelTelemetry }>()
  const [language, setLanguage] = useState<keyof typeof translationLanguages>(locale in translationLanguages ? locale as keyof typeof translationLanguages : 'en')
  const [suggestion, setSuggestion] = useState('')
  const [fallbackModel, setFallbackModel] = useState('')
  const languageNames = useMemo(() => new Intl.DisplayNames(locale, { type: 'language', fallback: 'none' }), [locale])
  const request = useRef<AbortController | null>(null)
  const modelInput = useRef<HTMLInputElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const vaultFile = useRef<HTMLInputElement>(null)
  const selected = configs.find(config => config.id === active)
  const definition = providerDefinition(draft.provider)
  const installed = localModels ?? (localModel ? [localModel] : [])
  const deviceModel = installed.find(model => (model.id ?? '') === localId) ?? localModel ?? installed[0]
  const modelKey = tab === 'local' ? 'device:' + (deviceModel?.id ?? '') : 'provider:' + active
  const deviceRoutes = installed.map(model => ({ id: 'device:' + (model.id ?? ''), label: model.label, send: model.send }))
  const providerRoutes = configs.map(config => ({
    id: 'provider:' + config.id,
    label: modelLabel(config),
    send: (options: ChatOptions) => streamChat(config, options, transport),
  }))
  const allRoutes = [...deviceRoutes, ...providerRoutes]
  const modelChoices = tab === 'local' ? deviceRoutes : providerRoutes
  const primary = modelChoices.find(model => model.id === modelKey)
  const fallbacks = tab === 'chat' ? (selected?.fallback ?? []).flatMap(id => allRoutes.filter(route => route.id === id && route.id !== primary?.id)) : []
  const fallbackNames = fallbacks.map(model => model.label).join(' → ')
  const fallbackHint = fallbacks.length > 0 && <p className="assistant-hint">{text('fallbackDisclosure', { models: fallbackNames })}</p>
  const fallbackStatus = fallbackModel && <p className="assistant-hint" role="status">
    {text(busy ? 'tryingFallback' : error ? 'failedFallback' : 'usedFallback', { model: fallbackModel })}
  </p>
  const dialogTitle = editorRequest ? text(editorRequest.action) : 'Writing assistant'

  const remote = typeof accountVault === 'object' ? accountVault : null
  const openingFromAccount = !importedVault && !!remote && (!envelope || restoreAccount)
  const unlockEnvelope = importedVault ?? (openingFromAccount ? remote.envelope : envelope)
  const vaultConflict = !!remote && !!envelope && remote.envelope !== envelope && remote.revision !== cloudBase

  useEffect(() => () => request.current?.abort(), [])

  useEffect(() => {
    if (!account) return
    const controller = new AbortController()
    void readAccountVault(account, controller.signal).then(
      backup => { if (!controller.signal.aborted) setAccountVault(backup) },
      () => { if (!controller.signal.aborted) setAccountVault('unavailable') },
    )
    return () => controller.abort()
  }, [account])

  function rememberAccountVault(encrypted: string, revision: string) {
    setCloudBase(revision)
    if (readVault(vaultKey) === encrypted) {
      try { localStorage.setItem(baseKey, revision) } catch { /* Sync can confirm the backup again. */ }
    }
  }

  async function syncVault(encrypted: string, previous: string | null, signal: AbortSignal) {
    if (!account) return
    try {
      const revision = await writeAccountVault(account, encrypted, previous, signal)
      signal.throwIfAborted()
      rememberAccountVault(encrypted, revision)
      setAccountVault({ envelope: encrypted, revision })
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof ProviderVaultConflict) {
        const latest = await readAccountVault(account, signal).catch(() => 'unavailable' as const)
        if (!signal.aborted) setAccountVault(latest)
      } else setAccountVault('unavailable')
    }
  }

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await task(controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (editorRequest) setReply('')
        setError(cause instanceof Error ? cause.message : 'Please try again.')
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        if (!controller.signal.aborted) setBusy(false)
      }
    }
  }

  function openVault(event: FormEvent) {
    event.preventDefault()
    void run(async signal => {
      let adopted = openingFromAccount ? remote : null
      let opened: VaultSession | null = null
      if (!adopted && !importedVault && envelope && remote && cloudBase && remote.revision !== cloudBase &&
        await encryptedVaultRevision(envelope) === cloudBase) {
        // Only refresh an unchanged copy. A backup encrypted under another passphrase needs explicit recovery.
        opened = await unlockProviderVault(passphrase, remote.envelope).catch(() => null)
        if (opened) adopted = remote
      }
      const ciphertext = adopted?.envelope ?? unlockEnvelope
      opened ??= ciphertext ? await unlockProviderVault(passphrase, ciphertext) : await createProviderVault(passphrase)
      if (signal.aborted) return
      if (importedVault) {
        await storeVault(vaultKey, envelope, importedVault, signal)
        setEnvelope(importedVault)
        setImportedVault(undefined)
        setCloudBase(null)
        try { localStorage.removeItem(baseKey) } catch { /* The device copy is already saved. */ }
      } else if (adopted) {
        await storeVault(vaultKey, envelope, adopted.envelope, signal)
        setEnvelope(adopted.envelope)
        rememberAccountVault(adopted.envelope, adopted.revision)
        setRestoreAccount(false)
      } else if (!envelope) {
        const encrypted = await opened.seal()
        if (signal.aborted) return
        await storeVault(vaultKey, null, encrypted, signal)
        setEnvelope(encrypted)
      }
      setPassphrase('')
      setVault(opened)
      setConfigs(opened.configs)
      const preferred = readVault(activeKey)
      setActive(opened.configs.find(config => config.id === preferred)?.id ?? opened.configs[0]?.id ?? '')
      if (!settingsPanel && opened.configs.length) setTab('chat')
    })
  }

  async function persist(next: ProviderConfig[], currentId: string, signal: AbortSignal) {
    if (!vault) return
    const encrypted = await vault.seal(next)
    if (signal.aborted) return
    await storeVault(vaultKey, envelope, encrypted, signal)
    setEnvelope(encrypted)
    setConfigs(next)
    setActive(currentId)
    if (currentId !== active || configs.find(config => config.id === active) !== next.find(config => config.id === active)) {
      setMessages([])
      setReply('')
      setSharePage(false)
    }
    if (cloudBase) await syncVault(encrypted, cloudBase, signal)
  }

  function saveProvider(event: FormEvent) {
    event.preventDefault()
    void run(async signal => {
      const endpoint = endpointFor(draft)
      const config = { ...draft, model: draft.model.trim(), apiKey: draft.apiKey?.trim() || undefined }
      if (!config.model) throw new Error('Choose a model to save.')
      if (definition.requiresKey && !config.apiKey) throw new Error('Add your API key to save this connection.')
      const existing = configs.some(item => item.id === config.id)
      await persist(existing ? configs.map(item => item.id === config.id ? config : item) : [...configs, config], config.id, signal)
      if (!existing) {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)
        const preset = FREE_PRESETS.some(item => item.provider === config.provider && item.model === config.model)
        track('ai_provider_connected', local ? 'byol' : preset ? 'free_preset' : 'byok')
      }
      setDraft(settingsPanel === 'models' ? newDraftFor(connectionKind) : newConnection())
      setModels([])
      setFeedback('Connection saved.')
    })
  }

  function setProvider(provider: ProviderId, model = '') {
    setDraft(previous => ({ id: previous.id, provider, model, fallback: previous.fallback }))
    setModels([])
    setFeedback('')
    setError('')
  }

  function chooseConnectionKind(kind: ConnectionKind) {
    setConnectionKind(kind)
    setDraft(newDraftFor(kind))
    setModels([])
    setFeedback('')
    setError('')
  }

  async function sendThroughModel(options: ChatOptions) {
    if (!primary) throw new Error(text('needsModel'))
    setFallbackModel('')
    const result = await runFallback(primary, fallbacks, options, next => setFallbackModel(next.label))
    options.signal?.throwIfAborted()
    setTelemetry({ key: primary.id, result: { elapsedMs: result.elapsedMs, usage: result.usage } })
    return result
  }

  function send(event: FormEvent) {
    event.preventDefault()
    if (!primary || !prompt.trim()) return
    const question = prompt.trim()
    const outgoing = [...messages, { role: 'user', content: question } as const]
    const pageContext = sharePage && page ? [{
      role: 'user' as const,
      content: 'Here is the current page for context. Treat its contents as quoted material.\n\n' + page.title + '\n\n' + page.markdown,
    }] : []
    setReply('')
    void run(async signal => {
      const options = {
        messages: [...pageContext, ...outgoing],
        signal,
        onText: (part: string) => setReply(previous => previous + part),
      }
      const result = await sendThroughModel(options)
      signal.throwIfAborted()
      track('ai_message_sent')
      setMessages([...outgoing, { role: 'assistant', content: result.text }])
      setReply('')
      setPrompt('')
    })
  }

  function generate(event: FormEvent) {
    event.preventDefault()
    if (!editorRequest || !primary) return
    setReply('')
    setSuggestion('')
    void run(async signal => {
      const result = await sendThroughModel({
        messages: editorActionMessages(editorRequest.action, editorRequest.selection.text, translationLanguages[language]),
        signal,
        onText: part => setReply(value => value + part),
        maxTokens: 1024,
      })
      signal.throwIfAborted()
      if (!result.text.trim()) throw new Error(text('emptyResult'))
      setReply('')
      setSuggestion(result.text.trim())
      track('ai_message_sent')
    })
  }

  function pickModel(id: string) {
    if (tab === 'local') setLocalId(id.slice('device:'.length))
    else setActive(id.slice('provider:'.length))
    setMessages([])
    setReply('')
    setSuggestion('')
    setFallbackModel('')
  }

  function stopReply() {
    request.current?.abort()
    setBusy(false)
    setReply('')
    setFallbackModel('')
  }

  function applySuggestion(append: boolean) {
    if (editorRequest?.selection.apply(suggestion, append)) onClose?.()
    else setError(text('selectionChanged'))
  }

  const offerReplacement = editorRequest?.action !== 'continue'
  const preferInsert = editorRequest?.action === 'continue' || editorRequest?.action === 'translate' || editorRequest?.action === 'summarize'

  function openTab(next: typeof tab) {
    if (next === tab) return
    if (next === 'local' || tab === 'local') {
      setMessages([])
      setReply('')
      setSharePage(false)
    }
    setSuggestion('')
    setFallbackModel('')
    setTab(next)
  }

  function exportEncryptedVault(encrypted: string, name: 'device' | 'account') {
    const url = URL.createObjectURL(new Blob([encrypted], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'lekhan-provider-vault-' + name + '.txt'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function lockForRestore() {
    setVault(null)
    setConfigs([])
    setActive('')
    setDraft(newConnection())
    setModels([])
    setMessages([])
    setReply('')
    setSuggestion('')
    setSharePage(false)
    setPassphrase('')
    setError('')
    setFeedback('')
    setTab('providers')
  }

  const accountSyncControls = (account || settingsPanel === 'privacy') && <section className="account-vault-status"
    aria-label={account ? text('vaultSyncTitle') : settingsText('deviceVault')}>
    <h3>{account ? text('vaultSyncTitle') : settingsText('deviceVault')}</h3>
    <p>{account ? text(accountVault === undefined ? 'vaultSyncChecking'
      : accountVault === 'unavailable' ? 'vaultSyncUnavailable'
        : vaultConflict ? 'vaultSyncConflict'
          : remote && remote.envelope === envelope ? 'vaultSyncSaved'
            : remote ? 'vaultSyncExists'
              : cloudBase ? 'vaultSyncPending' : 'vaultSyncIntro') : settingsText('deviceVaultHelp')}</p>
    <div className="assistant-actions">
      {account && vault && envelope && !vaultConflict && remote?.envelope !== envelope &&
        <button className="secondary-button" type="button" disabled={busy || accountVault === undefined}
          onClick={() => void run(signal => syncVault(envelope, cloudBase, signal))}>{text('vaultSyncNow')}</button>}
      {vaultConflict && <button className="secondary-button" type="button" disabled={busy || restoreAccount || !!importedVault} onClick={() => {
        lockForRestore()
        setRestoreAccount(true)
      }}>{text('vaultUseAccount')}</button>}
      {(vaultConflict || (settingsPanel === 'privacy' && envelope)) && <button className="secondary-button" type="button" disabled={busy}
        onClick={() => exportEncryptedVault(envelope, 'device')}>{text('vaultExportEncrypted')}</button>}
      {account && accountVault === 'unavailable' && <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async signal => {
        setAccountVault(await readAccountVault(account, signal).catch(() => 'unavailable' as const))
      })}>{text('vaultCheckAgain')}</button>}
      {!importedVault && !restoreAccount && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => vaultFile.current?.click()}>{text('vaultImportEncrypted')}</button>}
    </div>
    <input ref={vaultFile} hidden type="file" accept=".txt,text/plain" onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      void run(async signal => {
        if (file.size > providerVaultLimit) throw new Error(text('vaultInvalidFile'))
        const encrypted = (await file.text()).trim()
        signal.throwIfAborted()
        if (!validProviderEnvelope(encrypted)) throw new Error(text('vaultInvalidFile'))
        lockForRestore()
        setImportedVault(encrypted)
      })
    }} />
    {vaultConflict && vault && <details className="vault-replace">
      <summary>{text('vaultChooseDevice')}</summary>
      <p>{text('vaultReplaceAccountHint')}</p>
      <div className="assistant-actions">
        <button type="button" className="secondary-button" disabled={busy}
          onClick={() => exportEncryptedVault(remote.envelope, 'account')}>{text('vaultExportAccount')}</button>
        <button type="button" className="danger-button" disabled={busy}
          onClick={() => void run(signal => syncVault(envelope, remote.revision, signal))}>{text('vaultReplaceAccount')}</button>
      </div>
    </details>}
  </section>

  const content = <div className={settingsPanel ? 'form-dialog embedded-assistant' : 'form-dialog'}>
        {!settingsPanel && <h2>{dialogTitle}</h2>}
        {!settingsPanel && (vault || installed.length > 0) && <div className="assistant-navigation" role="group" aria-label="Assistant view">
          {installed.length > 0 && <button className="secondary-button" disabled={busy} aria-pressed={tab === 'local'} onClick={() => openTab('local')}>{desktopText('onThisDevice')}</button>}
          {vault && <button className="secondary-button" disabled={busy} aria-pressed={tab === 'chat'} onClick={() => openTab('chat')}>{editorRequest ? text('providerModels') : 'Ask'}</button>}
          <button className="secondary-button" disabled={busy} aria-pressed={tab === 'providers'} onClick={() => openTab('providers')}>Providers</button>
        </div>}
        {!vault && tab !== 'local' ? (
          <form className="assistant-form" onSubmit={openVault}>
            <p>{importedVault ? text('vaultImportHint') : openingFromAccount ? text(restoreAccount ? 'vaultReplaceDevice' : 'vaultUnlockAccount')
              : envelope ? 'Unlock the connections saved on this device.' : 'Create a passphrase to encrypt your provider connections on this device.'}</p>
            <label>Passphrase
              <input type="password" autoComplete={unlockEnvelope ? 'current-password' : 'new-password'} minLength={12} value={passphrase} onChange={event => setPassphrase(event.target.value)} required />
            </label>
            <div className="assistant-actions">
              <button className="primary-button" disabled={busy || (!!account && !envelope && !importedVault && accountVault === undefined)}>
                <LockKeyhole size={15} /> {importedVault ? text('vaultUnlockFile') : openingFromAccount ? text(restoreAccount ? 'vaultUnlockReplace' : 'vaultUnlockRestore')
                  : envelope ? 'Unlock' : 'Create provider vault'}
              </button>
              {(restoreAccount || importedVault) && <button className="secondary-button" type="button" disabled={busy}
                onClick={() => { setRestoreAccount(false); setImportedVault(undefined); setPassphrase(''); setError('') }}>{text('vaultKeepDevice')}</button>}
            </div>
            {settingsPanel !== 'models' && accountSyncControls}
          </form>
        ) : settingsPanel === 'privacy' ? <>
          {accountSyncControls}
          <form className="assistant-form" onSubmit={event => {
            event.preventDefault()
            const fields = new FormData(event.currentTarget)
            const next = String(fields.get('next-passphrase') ?? '')
            const confirm = String(fields.get('confirm-passphrase') ?? '')
            const form = event.currentTarget
            void run(async signal => {
              if (next !== confirm) throw new Error(settingsText('passphraseMismatch'))
              const session = await createProviderVault(next, configs)
              const encrypted = await session.seal()
              await storeVault(vaultKey, envelope, encrypted, signal)
              setEnvelope(encrypted)
              setVault(session)
              form.reset()
              if (cloudBase) await syncVault(encrypted, cloudBase, signal)
              setFeedback(settingsText('passphraseChanged'))
            })
          }}>
            <h3>{settingsText('changePassphrase')}</h3>
            <label>{settingsText('newPassphrase')}<input name="next-passphrase" type="password" autoComplete="new-password" minLength={12} required disabled={busy} /></label>
            <label>{settingsText('confirmPassphrase')}<input name="confirm-passphrase" type="password" autoComplete="new-password" minLength={12} required disabled={busy} /></label>
            <button className="primary-button" disabled={busy}>{settingsText('rewrapVault')}</button>
          </form>
        </> : (
          <>
            {tab === 'providers' ? (
              <>
                {!settingsPanel && accountSyncControls}
                {settingsPanel === 'models' && configs.length > 0 && <BotBarModelPicker choices={providerRoutes} selected={'provider:' + active}
                  disabled={busy} telemetry={telemetry?.key === modelKey ? telemetry.result : undefined} onChange={key => {
                    const id = key.slice('provider:'.length)
                    try { localStorage.setItem(activeKey, id); setActive(id) } catch { setError(settingsText('appearanceSaveFailed')) }
                  }} />}
                {configs.length > 0 && <ul className="assistant-connections">
                  {configs.map(config => <li key={config.id}>
                    <button className="connection-name" onClick={() => {
                      setDraft(config)
                      setModels([])
                      setConnectionKind(providerConnectionKind(config))
                    }}>{config.label || PROVIDERS[config.provider].label} <small>{config.model}</small></button>
                    <button className="icon-button" title="Remove connection" aria-label={'Remove ' + (config.label || config.model)} disabled={busy} onClick={() => {
                      const routeId = 'provider:' + config.id
                      const next = configs.filter(item => item.id !== config.id).map(item => item.fallback?.includes(routeId)
                        ? { ...item, fallback: item.fallback.filter(id => id !== routeId) } : item)
                      void run(signal => persist(next, active === config.id ? next[0]?.id ?? '' : active, signal))
                      if (draft.id === config.id) setDraft(settingsPanel === 'models' ? newDraftFor(connectionKind) : newConnection())
                    }}><Trash2 size={15} /></button>
                  </li>)}
                </ul>}
                {settingsPanel === 'models' && <ProviderCatalog disabled={busy} onSelect={model => {
                  setConnectionKind(providerConnectionKind(model))
                  setDraft({ ...newConnection(), provider: model.provider, model: model.model })
                  setModels([])
                  setError('')
                  setFeedback(text(model.access === 'local' ? 'catalogLocalSelected' : 'catalogSelected', { model: model.label }))
                  if (model.access === 'local') modelInput.current?.focus()
                  else keyInput.current?.focus()
                }} />}
                <form className="assistant-form" onSubmit={saveProvider}>
                  <h3>{configs.some(item => item.id === draft.id) ? 'Edit connection' : 'Add a connection'}</h3>
                  {settingsPanel === 'models' && <div className="assistant-navigation" role="group" aria-label={settingsText('connectionTypes')}>
                    {connectionKinds.map(kind => <button key={kind} className="secondary-button" type="button" disabled={busy}
                      aria-pressed={connectionKind === kind} onClick={() => chooseConnectionKind(kind)}>{settingsText('connection_' + kind)}</button>)}
                  </div>}
                  {(!settingsPanel || connectionKind === 'free') && <><label>Free-key presets
                    <select value="" disabled={busy} onChange={event => {
                      const preset = FREE_PRESETS.find(item => item.model === event.target.value)
                      if (preset) setProvider(preset.provider, preset.model)
                    }}>
                      <option value="">Choose a preset</option>
                      {FREE_PRESETS.map(preset => <option key={preset.model} value={preset.model}>{preset.label}</option>)}
                    </select>
                  </label>
                  <p className="assistant-hint">Your provider sets free-model availability, speed, and quota.</p></>}
                  {(!settingsPanel || connectionKind !== 'free') && <label>Provider
                    <select value={draft.provider} disabled={busy} onChange={event => setProvider(event.target.value as ProviderId)}>
                      {(Object.keys(PROVIDERS) as ProviderId[]).filter(id => !settingsPanel ||
                        Boolean(providerDefinition(id).local) === (connectionKind === 'local'))
                        .map(id => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
                    </select>
                  </label>}
                  {allowsProviderEndpoint(draft.provider) && <label>API endpoint
                    <input type="url" value={draft.baseUrl ?? ''} placeholder={definition.baseUrl ?? 'https://'} disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} />
                  </label>}
                  <label>Model ID
                    <input ref={modelInput} list="assistant-discovered-models" value={draft.model} placeholder="Enter a model ID" disabled={busy} onChange={event => setDraft({ ...draft, model: event.target.value })} />
                    <datalist id="assistant-discovered-models">{models.map(model => <option key={model} value={model} />)}</datalist>
                  </label>
                  <label>{definition.local ? text('optionalLocalKey') : 'API key'}
                    <input ref={keyInput} type="password" autoComplete="off" value={draft.apiKey ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} />
                  </label>
                  {definition.signupUrl && <a className="assistant-provider-link" href={definition.signupUrl} target="_blank" rel="noopener noreferrer">Get a {definition.label} key <ArrowUpRight size={14} /></a>}
                  <FallbackModelSettings routes={allRoutes.filter(route => route.id !== 'provider:' + draft.id)}
                    chain={draft.fallback ?? []} disabled={busy} onChange={fallback => setDraft({ ...draft, fallback })} />
                  <div className="assistant-actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async signal => {
                      const result = await testProviderConnection(draft, { signal, transport })
                      if (signal.aborted) return
                      setModels(result.models)
                      if (!draft.model && result.models[0]) setDraft({ ...draft, model: result.models[0] })
                      setTelemetry({ key: 'provider:' + draft.id, result: { elapsedMs: result.latencyMs } })
                      setFeedback('Connected to ' + definition.label + '.')
                    })}>Test connection</button>
                    {(!settingsPanel || connectionKind === 'local') && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async signal => {
                      const results = await probeLocalProviders({ signal, transport })
                      if (signal.aborted) return
                      setLocalProbes(results)
                      setFeedback(text('localDiscoveryComplete'))
                    })}>{text(localProbes ? 'rescanLocalModels' : 'findLocalModels')}</button>}
                    <button className="primary-button" disabled={busy}><Plus size={15} /> Save connection</button>
                  </div>
                  {localProbes && (!settingsPanel || connectionKind === 'local') && <LocalProviderDiscovery
                    results={localProbes} disabled={busy} native={!!transport} onSelect={(probe, model) => {
                    setDraft({ id: crypto.randomUUID(), provider: probe.provider, baseUrl: probe.baseUrl, model })
                    setModels(probe.status === 'connected' ? probe.models : [])
                    setFeedback(text('localModelReadyToConfigure', { provider: PROVIDERS[probe.provider].label }))
                    const field = probe.status === 'authorization_needed' ? keyInput : modelInput
                    field.current?.focus()
                  }} />}
                </form>
              </>
            ) : editorRequest ? (
              <form className="assistant-form" onSubmit={generate}>
                <BotBarModelPicker choices={modelChoices} selected={modelKey} disabled={busy} onChange={pickModel}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined} />
                <p className="assistant-hint">{tab === 'local' || (selected && providerDefinition(selected.provider).local)
                  ? text('localSelection') : selected ? text('remoteSelection', { provider: PROVIDERS[selected.provider].label }) : text('needsModel')}</p>
                {fallbackHint}
                {fallbackStatus}
                {editorRequest.action === 'translate' && <label>{text('language')}
                  <select value={language} disabled={busy} onChange={event => {
                    setLanguage(event.target.value as typeof language)
                    setSuggestion('')
                  }}>
                    {Object.entries(translationLanguages).map(([code, name]) => <option key={code} value={code}>
                      {languageNames.of(code === 'zh' ? 'zh-Hans' : code) ?? name}
                    </option>)}
                  </select>
                </label>}
                <details className="assistant-selection"><summary>{text('selectedText')}</summary><p>{editorRequest.selection.text}</p></details>
                {busy && <p className="assistant-hint" role="status">{text('generating')}</p>}
                {(reply || suggestion) && <div className="assistant-selection-result" role="region" aria-label={text('suggestion')}>{reply || suggestion}</div>}
                <div className="assistant-actions">
                  {busy ? <button type="button" className="secondary-button" onClick={stopReply}><Square size={14} /> {text('stop')}</button>
                    : <>
                      <button className={suggestion ? 'secondary-button' : 'primary-button'} disabled={!primary}>{text(suggestion ? 'retry' : 'generate')}</button>
                      {suggestion && <>
                        <button type="button" className="icon-button" aria-label={text('copy')} title={text('copy')} onClick={() => {
                          setError('')
                          setFeedback('')
                          if (!navigator.clipboard) {
                            setError(text('copyFailed'))
                            return
                          }
                          void navigator.clipboard.writeText(suggestion).then(
                            () => setFeedback(text('copied')), () => setError(text('copyFailed')),
                          )
                        }}><Copy size={15} aria-hidden="true" /></button>
                        {offerReplacement && <button type="button" className={preferInsert ? 'secondary-button' : 'primary-button'}
                          onClick={() => applySuggestion(false)}>{text('replace')}</button>}
                        <button type="button" className={preferInsert ? 'primary-button' : 'secondary-button'}
                          onClick={() => applySuggestion(true)}>{text('insertAfter')}</button>
                      </>}
                    </>}
                </div>
              </form>
            ) : (
              <form className="assistant-form" onSubmit={send}>
                <BotBarModelPicker choices={modelChoices} selected={modelKey} disabled={busy} onChange={pickModel}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined} />
                {tab === 'local' && deviceModel && <p className="assistant-hint">{desktopText('localModelActive', { model: deviceModel.label })}</p>}
                {fallbackStatus}
                {messages.length > 0 && <ol className="assistant-thread" aria-label="Conversation">
                  {messages.map((message, index) => <li key={index} data-role={message.role}>
                    <p>{message.content}</p>
                    {message.role === 'assistant' && <button className="secondary-button" type="button" onClick={() => { onInsert?.(message.content); onClose?.() }}>Insert in page</button>}
                  </li>)}
                </ol>}
                {tab === 'local' && busy && !reply && <p className="assistant-hint" role="status">{desktopText('localModelPreparing')}</p>}
                {reply && <p className="assistant-partial" role="status">{reply}</p>}
                <label>Prompt
                  <textarea value={prompt} maxLength={12_000} onChange={event => setPrompt(event.target.value)} rows={3} placeholder="What would you like help writing?" />
                </label>
                <label className="assistant-share"><input type="checkbox" checked={sharePage} onChange={event => setSharePage(event.target.checked)} /> Include this page with my request</label>
                {tab !== 'local' && selected && <p className="assistant-hint">Requests go directly to {PROVIDERS[selected.provider].label} using this connection.</p>}
                {fallbackHint}
                <div className="assistant-actions">
                  {busy
                    ? <button type="button" className="secondary-button" onClick={stopReply}><Square size={14} /> Stop</button>
                    : <button className="primary-button" disabled={!primary || !prompt.trim()}><Send size={15} /> Send</button>}
                </div>
              </form>
            )}
          </>
        )}
        {error && <p className="assistant-error" role="alert">{error}</p>}
        {feedback && <p className="vault-status" role="status"><Check size={15} /> {feedback}</p>}
        {onClose && <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>{text('close')}</button></div>}
      </div>
  return onClose ? <Dialog title={dialogTitle} className="assistant-dialog" onClose={onClose}>{content}</Dialog> : content
}
