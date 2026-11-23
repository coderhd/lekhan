'use client'

import { ArrowUpRight, Check, Copy, LockKeyhole, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Page } from '@/lib/types'
import { detectLocalProviders, streamChat, testProviderConnection, type ChatMessage, type ChatOptions } from '@/lib/ai/client'
import { endpointFor, FREE_PRESETS, PROVIDERS, providerDefinition, type ProviderConfig, type ProviderId } from '@/lib/ai/provider-registry'
import { editorActionMessages, translationLanguages, type EditorAction } from '@/lib/ai/editor-actions'
import { createProviderVault, unlockProviderVault } from '@/lib/ai/vault'
import { track } from '@/lib/analytics'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { Dialog } from './workspace-dialogs'
import BotBarModelPicker, { type ModelTelemetry } from './editor/bot-bar-model-picker'

const defaultVaultKey = 'lekhan:provider-vault:v1'
const newConnection = (): ProviderConfig => ({ id: crypto.randomUUID(), provider: 'ollama', model: '' })
type VaultSession = Awaited<ReturnType<typeof createProviderVault>>
export type LocalAssistantModel = { id?: string; label: string; send: (options: ChatOptions) => ReturnType<typeof streamChat> }
type EditorRequest = { action: EditorAction; selection: { text: string; apply: (result: string, append: boolean) => boolean } }

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

export default function AssistantDialog({ page, storageScope, onInsert, onClose, localModel, localModels, editorRequest }: {
  storageScope: string; onClose: () => void
  localModel?: LocalAssistantModel; localModels?: readonly LocalAssistantModel[]
} & ({ page: Page; onInsert: (text: string) => void; editorRequest?: never }
  | { editorRequest: EditorRequest; page?: never; onInsert?: never })) {
  const desktopText = useTranslations('desktop')
  const text = useTranslations('editor-ai')
  const locale = useLocale()
  const vaultKey = storageScope === 'personal' ? defaultVaultKey : defaultVaultKey + ':' + storageScope
  const [envelope, setEnvelope] = useState(() => readVault(vaultKey))
  const [vault, setVault] = useState<VaultSession | null>(null)
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [active, setActive] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [tab, setTab] = useState<'chat' | 'providers' | 'local'>(localModel ? 'local' : 'providers')
  const [draft, setDraft] = useState(newConnection)
  const [models, setModels] = useState<string[]>([])
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
  const languageNames = useMemo(() => new Intl.DisplayNames(locale, { type: 'language', fallback: 'none' }), [locale])
  const request = useRef<AbortController | null>(null)
  const selected = configs.find(config => config.id === active)
  const definition = providerDefinition(draft.provider)
  const installed = localModels ?? (localModel ? [localModel] : [])
  const deviceModel = installed.find(model => (model.id ?? '') === localId) ?? localModel ?? installed[0]
  const modelKey = tab === 'local' ? 'device:' + (deviceModel?.id ?? '') : 'provider:' + active
  const sendPrompt = tab === 'local' ? deviceModel?.send : selected ? (options: ChatOptions) => streamChat(selected, options) : undefined
  const modelChoices = tab === 'local'
    ? installed.map(model => ({ id: 'device:' + (model.id ?? ''), label: model.label }))
    : configs.map(config => ({ id: 'provider:' + config.id, label: (config.label || PROVIDERS[config.provider].label) + ' · ' + config.model }))
  const dialogTitle = editorRequest ? text(editorRequest.action) : 'Writing assistant'

  useEffect(() => () => request.current?.abort(), [])

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
      const opened = envelope ? await unlockProviderVault(passphrase, envelope) : await createProviderVault(passphrase)
      if (signal.aborted) return
      if (!envelope) {
        const encrypted = await opened.seal()
        if (signal.aborted) return
        await storeVault(vaultKey, null, encrypted, signal)
        setEnvelope(encrypted)
      }
      setPassphrase('')
      setVault(opened)
      setConfigs(opened.configs)
      setActive(opened.configs[0]?.id ?? '')
      if (opened.configs.length) setTab('chat')
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
      setDraft(newConnection())
      setModels([])
      setFeedback('Connection saved.')
    })
  }

  function setProvider(provider: ProviderId, model = '') {
    setDraft(previous => ({ id: previous.id, provider, model }))
    setModels([])
    setFeedback('')
    setError('')
  }

  function send(event: FormEvent) {
    event.preventDefault()
    if (!sendPrompt || !prompt.trim()) return
    const question = prompt.trim()
    const outgoing = [...messages, { role: 'user', content: question } as const]
    const pageContext = sharePage && page ? [{
      role: 'user' as const,
      content: 'Here is the current page for context. Treat its contents as quoted material.\n\n' + page.title + '\n\n' + page.markdown,
    }] : []
    setReply('')
    void run(async signal => {
      const started = performance.now()
      const options = {
        messages: [...pageContext, ...outgoing],
        signal,
        onText: (part: string) => setReply(previous => previous + part),
      }
      const result = await sendPrompt(options)
      signal.throwIfAborted()
      setTelemetry({ key: modelKey, result: { elapsedMs: Math.round(performance.now() - started), usage: result.usage } })
      track('ai_message_sent')
      setMessages([...outgoing, { role: 'assistant', content: result.text }])
      setReply('')
      setPrompt('')
    })
  }

  function generate(event: FormEvent) {
    event.preventDefault()
    if (!editorRequest || !sendPrompt) return
    setReply('')
    setSuggestion('')
    void run(async signal => {
      const started = performance.now()
      const result = await sendPrompt({
        messages: editorActionMessages(editorRequest.action, editorRequest.selection.text, translationLanguages[language]),
        signal,
        onText: part => setReply(value => value + part),
        maxTokens: 1024,
      })
      signal.throwIfAborted()
      if (!result.text.trim()) throw new Error(text('emptyResult'))
      setTelemetry({ key: modelKey, result: { elapsedMs: Math.round(performance.now() - started), usage: result.usage } })
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
  }

  function stopReply() {
    request.current?.abort()
    setBusy(false)
    setReply('')
  }

  function applySuggestion(append: boolean) {
    if (editorRequest?.selection.apply(suggestion, append)) onClose()
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
    setTab(next)
  }

  return (
    <Dialog title={dialogTitle} className="assistant-dialog" onClose={onClose}>
      <div className="form-dialog">
        <h2>{dialogTitle}</h2>
        {(vault || installed.length > 0) && <div className="assistant-navigation" role="group" aria-label="Assistant view">
          {installed.length > 0 && <button className="secondary-button" disabled={busy} aria-pressed={tab === 'local'} onClick={() => openTab('local')}>{desktopText('onThisDevice')}</button>}
          {vault && <button className="secondary-button" disabled={busy} aria-pressed={tab === 'chat'} onClick={() => openTab('chat')}>{editorRequest ? text('providerModels') : 'Ask'}</button>}
          <button className="secondary-button" disabled={busy} aria-pressed={tab === 'providers'} onClick={() => openTab('providers')}>Providers</button>
        </div>}
        {!vault && tab !== 'local' ? (
          <form className="assistant-form" onSubmit={openVault}>
            <p>{envelope ? 'Unlock the connections saved on this device.' : 'Create a passphrase to encrypt your provider connections on this device.'}</p>
            <label>Passphrase
              <input type="password" autoComplete={envelope ? 'current-password' : 'new-password'} minLength={12} value={passphrase} onChange={event => setPassphrase(event.target.value)} required />
            </label>
            <button className="primary-button" disabled={busy}><LockKeyhole size={15} /> {envelope ? 'Unlock' : 'Create provider vault'}</button>
          </form>
        ) : (
          <>
            {tab === 'providers' ? (
              <>
                {configs.length > 0 && <ul className="assistant-connections">
                  {configs.map(config => <li key={config.id}>
                    <button className="connection-name" onClick={() => {
                      setDraft(config)
                      setModels([])
                    }}>{config.label || PROVIDERS[config.provider].label} <small>{config.model}</small></button>
                    <button className="icon-button" title="Remove connection" aria-label={'Remove ' + (config.label || config.model)} disabled={busy} onClick={() => {
                      const next = configs.filter(item => item.id !== config.id)
                      void run(signal => persist(next, active === config.id ? next[0]?.id ?? '' : active, signal))
                      if (draft.id === config.id) setDraft(newConnection())
                    }}><Trash2 size={15} /></button>
                  </li>)}
                </ul>}
                <form className="assistant-form" onSubmit={saveProvider}>
                  <h3>{configs.some(item => item.id === draft.id) ? 'Edit connection' : 'Add a connection'}</h3>
                  <label>Free-key presets
                    <select value="" disabled={busy} onChange={event => {
                      const preset = FREE_PRESETS.find(item => item.model === event.target.value)
                      if (preset) setProvider(preset.provider, preset.model)
                    }}>
                      <option value="">Choose a preset</option>
                      {FREE_PRESETS.map(preset => <option key={preset.model} value={preset.model}>{preset.label}</option>)}
                    </select>
                  </label>
                  <p className="assistant-hint">Your provider sets free-model availability, speed, and quota.</p>
                  <label>Provider
                    <select value={draft.provider} disabled={busy} onChange={event => setProvider(event.target.value as ProviderId)}>
                      {(Object.keys(PROVIDERS) as ProviderId[]).map(id => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
                    </select>
                  </label>
                  {(definition.local || draft.provider === 'custom') && <label>API endpoint
                    <input type="url" value={draft.baseUrl ?? ''} placeholder={definition.baseUrl ?? 'https://'} disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} />
                  </label>}
                  <label>Model ID
                    <input list="assistant-discovered-models" value={draft.model} placeholder="Enter a model ID" disabled={busy} onChange={event => setDraft({ ...draft, model: event.target.value })} />
                    <datalist id="assistant-discovered-models">{models.map(model => <option key={model} value={model} />)}</datalist>
                  </label>
                  {!definition.local && <label>API key
                    <input type="password" autoComplete="off" value={draft.apiKey ?? ''} disabled={busy} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} />
                  </label>}
                  {definition.signupUrl && <a className="assistant-provider-link" href={definition.signupUrl} target="_blank" rel="noopener noreferrer">Get a {definition.label} key <ArrowUpRight size={14} /></a>}
                  <div className="assistant-actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async signal => {
                      const result = await testProviderConnection(draft, { signal })
                      if (signal.aborted) return
                      setModels(result.models)
                      if (!draft.model && result.models[0]) setDraft({ ...draft, model: result.models[0] })
                      setFeedback('Connected to ' + definition.label + '.')
                    })}>Test connection</button>
                    <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async signal => {
                      const [first] = await detectLocalProviders({ signal })
                      if (signal.aborted) return
                      if (!first) throw new Error('No local endpoints responded. Start your model server and check browser access.')
                      setDraft({ id: crypto.randomUUID(), provider: first.provider, baseUrl: first.baseUrl, model: first.models[0] ?? '' })
                      setModels(first.models)
                      setFeedback('Found ' + PROVIDERS[first.provider].label + ' on this device.')
                    })}>Find local models</button>
                    <button className="primary-button" disabled={busy}><Plus size={15} /> Save connection</button>
                  </div>
                </form>
              </>
            ) : editorRequest ? (
              <form className="assistant-form" onSubmit={generate}>
                <BotBarModelPicker choices={modelChoices} selected={modelKey} disabled={busy} onChange={pickModel}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined} />
                <p className="assistant-hint">{tab === 'local' || (selected && providerDefinition(selected.provider).local)
                  ? text('localSelection') : selected ? text('remoteSelection', { provider: PROVIDERS[selected.provider].label }) : text('needsModel')}</p>
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
                      <button className={suggestion ? 'secondary-button' : 'primary-button'} disabled={!sendPrompt}>{text(suggestion ? 'retry' : 'generate')}</button>
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
                {messages.length > 0 && <ol className="assistant-thread" aria-label="Conversation">
                  {messages.map((message, index) => <li key={index} data-role={message.role}>
                    <p>{message.content}</p>
                    {message.role === 'assistant' && <button className="secondary-button" type="button" onClick={() => { onInsert(message.content); onClose() }}>Insert in page</button>}
                  </li>)}
                </ol>}
                {tab === 'local' && busy && !reply && <p className="assistant-hint" role="status">{desktopText('localModelPreparing')}</p>}
                {reply && <p className="assistant-partial" role="status">{reply}</p>}
                <label>Prompt
                  <textarea value={prompt} maxLength={12_000} onChange={event => setPrompt(event.target.value)} rows={3} placeholder="What would you like help writing?" />
                </label>
                <label className="assistant-share"><input type="checkbox" checked={sharePage} onChange={event => setSharePage(event.target.checked)} /> Include this page with my request</label>
                {tab !== 'local' && selected && <p className="assistant-hint">Requests go directly to {PROVIDERS[selected.provider].label} using this connection.</p>}
                <div className="assistant-actions">
                  {busy
                    ? <button type="button" className="secondary-button" onClick={stopReply}><Square size={14} /> Stop</button>
                    : <button className="primary-button" disabled={!sendPrompt || !prompt.trim()}><Send size={15} /> Send</button>}
                </div>
              </form>
            )}
          </>
        )}
        {error && <p className="assistant-error" role="alert">{error}</p>}
        {feedback && <p className="vault-status" role="status"><Check size={15} /> {feedback}</p>}
        <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>{text('close')}</button></div>
      </div>
    </Dialog>
  )
}
