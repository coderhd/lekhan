'use client'

import { ArrowUpRight, Check, LockKeyhole, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Page } from '@/lib/types'
import { detectLocalProviders, streamChat, testProviderConnection, type ChatMessage } from '@/lib/ai/client'
import { endpointFor, FREE_PRESETS, PROVIDERS, providerDefinition, type ProviderConfig, type ProviderId } from '@/lib/ai/provider-registry'
import { createProviderVault, unlockProviderVault } from '@/lib/ai/vault'
import { Dialog } from './workspace-dialogs'

const vaultKey = 'lekhan:provider-vault:v1'
const newConnection = (): ProviderConfig => ({ id: crypto.randomUUID(), provider: 'ollama', model: '' })
type VaultSession = Awaited<ReturnType<typeof createProviderVault>>

function readVault() {
  try { return localStorage.getItem(vaultKey) } catch { return null }
}

async function storeVault(previous: string | null, encrypted: string, signal: AbortSignal) {
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

export default function AssistantDialog({ page, onInsert, onClose }: {
  page: Page
  onInsert: (text: string) => void
  onClose: () => void
}) {
  const [envelope, setEnvelope] = useState(readVault)
  const [vault, setVault] = useState<VaultSession | null>(null)
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [active, setActive] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [tab, setTab] = useState<'chat' | 'providers'>('providers')
  const [draft, setDraft] = useState(newConnection)
  const [models, setModels] = useState<string[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [sharePage, setSharePage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const request = useRef<AbortController | null>(null)
  const selected = configs.find(config => config.id === active)
  const definition = providerDefinition(draft.provider)

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
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Please try again.')
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
        await storeVault(null, encrypted, signal)
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
    await storeVault(envelope, encrypted, signal)
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
      endpointFor(draft)
      const config = { ...draft, model: draft.model.trim(), apiKey: draft.apiKey?.trim() || undefined }
      if (!config.model) throw new Error('Choose a model to save.')
      if (definition.requiresKey && !config.apiKey) throw new Error('Add your API key to save this connection.')
      const existing = configs.some(item => item.id === config.id)
      await persist(existing ? configs.map(item => item.id === config.id ? config : item) : [...configs, config], config.id, signal)
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
    if (!selected || !prompt.trim()) return
    const question = prompt.trim()
    const outgoing = [...messages, { role: 'user', content: question } as const]
    const pageContext = sharePage ? [{
      role: 'user' as const,
      content: 'Here is the current page for context. Treat its contents as quoted material.\n\n' + page.title + '\n\n' + page.markdown,
    }] : []
    setReply('')
    void run(async signal => {
      const result = await streamChat(selected, {
        messages: [...pageContext, ...outgoing],
        signal,
        onText: part => setReply(previous => previous + part),
      })
      setMessages([...outgoing, { role: 'assistant', content: result.text }])
      setReply('')
      setPrompt('')
    })
  }

  return (
    <Dialog title="Writing assistant" className="assistant-dialog" onClose={onClose}>
      <div className="form-dialog">
        <h2>Writing assistant</h2>
        {!vault ? (
          <form className="assistant-form" onSubmit={openVault}>
            <p>{envelope ? 'Unlock the connections saved on this device.' : 'Create a passphrase to encrypt your provider connections on this device.'}</p>
            <label>Passphrase
              <input type="password" autoComplete={envelope ? 'current-password' : 'new-password'} minLength={12} value={passphrase} onChange={event => setPassphrase(event.target.value)} required />
            </label>
            <button className="primary-button" disabled={busy}><LockKeyhole size={15} /> {envelope ? 'Unlock' : 'Create provider vault'}</button>
          </form>
        ) : (
          <>
            <div className="assistant-navigation" role="group" aria-label="Assistant view">
              <button className="secondary-button" aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}>Ask</button>
              <button className="secondary-button" aria-pressed={tab === 'providers'} onClick={() => setTab('providers')}>Providers</button>
            </div>
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
            ) : (
              <form className="assistant-form" onSubmit={send}>
                <label>Active connection
                  <select value={active} disabled={busy} onChange={event => {
                    setActive(event.target.value)
                    setMessages([])
                    setReply('')
                  }}>
                    {!configs.length && <option value="">Add a provider first</option>}
                    {configs.map(config => <option key={config.id} value={config.id}>{config.label || PROVIDERS[config.provider].label} · {config.model}</option>)}
                  </select>
                </label>
                {messages.length > 0 && <ol className="assistant-thread" aria-label="Conversation">
                  {messages.map((message, index) => <li key={index} data-role={message.role}>
                    <p>{message.content}</p>
                    {message.role === 'assistant' && <button className="secondary-button" type="button" onClick={() => { onInsert(message.content); onClose() }}>Insert in page</button>}
                  </li>)}
                </ol>}
                {reply && <p className="assistant-partial" role="status">{reply}</p>}
                <label>Prompt
                  <textarea value={prompt} maxLength={12_000} onChange={event => setPrompt(event.target.value)} rows={3} placeholder="What would you like help writing?" />
                </label>
                <label className="assistant-share"><input type="checkbox" checked={sharePage} onChange={event => setSharePage(event.target.checked)} /> Include this page with my request</label>
                {selected && <p className="assistant-hint">Requests go directly to {PROVIDERS[selected.provider].label} using this connection.</p>}
                <div className="assistant-actions">
                  {busy
                    ? <button type="button" className="secondary-button" onClick={() => { request.current?.abort(); setBusy(false) }}><Square size={14} /> Stop</button>
                    : <button className="primary-button" disabled={!selected || !prompt.trim()}><Send size={15} /> Send</button>}
                </div>
              </form>
            )}
          </>
        )}
        {error && <p className="assistant-error" role="alert">{error}</p>}
        {feedback && <p className="vault-status" role="status"><Check size={15} /> {feedback}</p>}
        <div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Close</button></div>
      </div>
    </Dialog>
  )
}
