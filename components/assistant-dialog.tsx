'use client'

import { ArrowUpRight, Check, Copy, LockKeyhole, Plus, Send, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Heading } from '@astryxdesign/core/Heading'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import type { Page } from '@/lib/types'
import { probeLocalProviders, streamChat, testProviderConnection, type ChatMessage, type ChatOptions, type LocalProviderProbe, type ProviderTransport } from '@/lib/ai/client'
import { allowsProviderEndpoint, endpointFor, FREE_PRESETS, PROVIDERS, providerConnectionKind, providerDefinition, type ProviderConfig, type ProviderId } from '@/lib/ai/provider-registry'
import { editorActionMessages, translationLanguages, type EditorAction } from '@/lib/ai/editor-actions'
import { runFallback } from '@/lib/ai/fallback'
import { createProviderVault, unlockProviderVault } from '@/lib/ai/vault'
import { encryptedVaultRevision, providerVaultLimit, readAccountVault, validProviderEnvelope, writeAccountVault, ProviderVaultConflict, vaultRevisionPattern, type CloudProviderVault } from '@/lib/ai/vault-sync'
import { track } from '@/lib/analytics'
import { useLocale, useTranslations } from '@/lib/i18n/client'
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
  const dialogTitle = editorRequest ? text(editorRequest.action) : text('writingAssistant')

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
      if (!config.model) throw new Error(text('missingModelForSave'))
      if (definition.requiresKey && !config.apiKey) throw new Error(text('missingKeyForSave'))
      const existing = configs.some(item => item.id === config.id)
      await persist(existing ? configs.map(item => item.id === config.id ? config : item) : [...configs, config], config.id, signal)
      if (!existing) {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)
        const preset = FREE_PRESETS.some(item => item.provider === config.provider && item.model === config.model)
        track('ai_provider_connected', local ? 'byol' : preset ? 'free_preset' : 'byok')
      }
      setDraft(settingsPanel === 'models' ? newDraftFor(connectionKind) : newConnection())
      setModels([])
      setFeedback(text('connectionSaved'))
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

  const accountSyncControls = (account || settingsPanel === 'privacy') && (
    <VStack gap={2} className="account-vault-status" aria-label={account ? text('vaultSyncTitle') : settingsText('deviceVault')}>
      <Heading level={3}>{account ? text('vaultSyncTitle') : settingsText('deviceVault')}</Heading>
      <Text size="sm" color="secondary">
        {account ? text(accountVault === undefined ? 'vaultSyncChecking'
          : accountVault === 'unavailable' ? 'vaultSyncUnavailable'
            : vaultConflict ? 'vaultSyncConflict'
              : remote && remote.envelope === envelope ? 'vaultSyncSaved'
                : remote ? 'vaultSyncExists'
                  : cloudBase ? 'vaultSyncPending' : 'vaultSyncIntro') : settingsText('deviceVaultHelp')}
      </Text>
      <HStack gap={2} wrap="wrap">
        {account && vault && envelope && !vaultConflict && remote?.envelope !== envelope && (
          <Button variant="secondary" size="sm" isDisabled={busy || accountVault === undefined}
            label={text('vaultSyncNow')} onClick={() => void run(signal => syncVault(envelope, cloudBase, signal))} />
        )}
        {vaultConflict && (
          <Button variant="secondary" size="sm" isDisabled={busy || restoreAccount || !!importedVault}
            label={text('vaultUseAccount')} onClick={() => { lockForRestore(); setRestoreAccount(true) }} />
        )}
        {(vaultConflict || (settingsPanel === 'privacy' && envelope)) && (
          <Button variant="secondary" size="sm" isDisabled={busy}
            label={text('vaultExportEncrypted')} onClick={() => exportEncryptedVault(envelope, 'device')} />
        )}
        {account && accountVault === 'unavailable' && (
          <Button variant="secondary" size="sm" isDisabled={busy} label={text('vaultCheckAgain')}
            onClick={() => void run(async signal => {
              setAccountVault(await readAccountVault(account, signal).catch(() => 'unavailable' as const))
            })} />
        )}
        {!importedVault && !restoreAccount && (
          <Button variant="secondary" size="sm" isDisabled={busy}
            label={text('vaultImportEncrypted')} onClick={() => vaultFile.current?.click()} />
        )}
      </HStack>
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
      {vaultConflict && vault && (
        <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold" size="sm">{text('vaultChooseDevice')}</Text>} className="vault-replace">
          <VStack gap={2}>
            <Text size="sm" color="secondary">{text('vaultReplaceAccountHint')}</Text>
            <HStack gap={2} wrap="wrap">
              <Button variant="secondary" size="sm" isDisabled={busy} label={text('vaultExportAccount')}
                onClick={() => exportEncryptedVault(remote.envelope, 'account')} />
              <Button variant="destructive" size="sm" isDisabled={busy} label={text('vaultReplaceAccount')}
                onClick={() => void run(signal => syncVault(envelope, remote.revision, signal))} />
            </HStack>
          </VStack>
        </Collapsible>
      )}
    </VStack>
  )

  const body = (
    <VStack gap={3} className={settingsPanel ? 'embedded-assistant' : undefined}>
      {!settingsPanel && (vault || installed.length > 0) && (
        <SegmentedControl
          label={text('assistantView')}
          value={tab}
          isDisabled={busy}
          size="sm"
          onChange={value => openTab(value as typeof tab)}
        >
          {installed.length > 0 && <SegmentedControlItem value="local" label={desktopText('onThisDevice')} />}
          {vault && <SegmentedControlItem value="chat" label={editorRequest ? text('providerModels') : text('assistantAsk')} />}
          <SegmentedControlItem value="providers" label={text('assistantProviders')} />
        </SegmentedControl>
      )}
      {!vault && tab !== 'local' ? (
        <form onSubmit={openVault}>
          <VStack gap={3} className="assistant-form">
            <Text color="secondary">
              {importedVault ? text('vaultImportHint') : openingFromAccount ? text(restoreAccount ? 'vaultReplaceDevice' : 'vaultUnlockAccount')
                : text(envelope ? 'unlockDeviceHint' : 'createVaultHint')}
            </Text>
            <TextInput
              type="password"
              label={text('vaultPassphrase')}
              autoComplete={unlockEnvelope ? 'current-password' : 'new-password'}
              isRequired
              width="100%"
              value={passphrase}
              onChange={setPassphrase}
            />
            <HStack gap={2} wrap="wrap">
              <Button
                type="submit"
                variant="primary"
                icon={<LockKeyhole size={15} />}
                isDisabled={busy || (!!account && !envelope && !importedVault && accountVault === undefined)}
                label={importedVault ? text('vaultUnlockFile') : openingFromAccount ? text(restoreAccount ? 'vaultUnlockReplace' : 'vaultUnlockRestore')
                  : text(envelope ? 'vaultUnlockDevice' : 'createVault')}
              />
              {(restoreAccount || importedVault) && (
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={busy}
                  label={text('vaultKeepDevice')}
                  onClick={() => { setRestoreAccount(false); setImportedVault(undefined); setPassphrase(''); setError('') }}
                />
              )}
            </HStack>
            {settingsPanel !== 'models' && accountSyncControls}
          </VStack>
        </form>
      ) : settingsPanel === 'privacy' ? (
        <VStack gap={4}>
          {accountSyncControls}
          <form onSubmit={event => {
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
            <VStack gap={3} align="start" className="assistant-form">
              <Heading level={3}>{settingsText('changePassphrase')}</Heading>
              <label>{settingsText('newPassphrase')}<input name="next-passphrase" type="password" autoComplete="new-password" minLength={12} required disabled={busy} /></label>
              <label>{settingsText('confirmPassphrase')}<input name="confirm-passphrase" type="password" autoComplete="new-password" minLength={12} required disabled={busy} /></label>
              <Button type="submit" variant="primary" isDisabled={busy} label={settingsText('rewrapVault')} />
            </VStack>
          </form>
        </VStack>
      ) : (
        <>
          {tab === 'providers' ? (
            <VStack gap={3}>
              {!settingsPanel && accountSyncControls}
              {settingsPanel === 'models' && configs.length > 0 && (
                <BotBarModelPicker
                  choices={providerRoutes}
                  selected={'provider:' + active}
                  disabled={busy}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined}
                  onChange={key => {
                    const id = key.slice('provider:'.length)
                    try { localStorage.setItem(activeKey, id); setActive(id) } catch { setError(settingsText('appearanceSaveFailed')) }
                  }}
                />
              )}
              {configs.length > 0 && (
                <VStack gap={1} className="assistant-connections">
                  {configs.map(config => (
                    <Item
                      key={config.id}
                      density="compact"
                      label={config.label || PROVIDERS[config.provider].label}
                      description={config.model}
                      isSelected={draft.id === config.id}
                      onClick={() => {
                        setDraft(config)
                        setModels([])
                        setConnectionKind(providerConnectionKind(config))
                      }}
                      endContent={
                        <IconButton
                          variant="ghost"
                          size="sm"
                          label={text('removeNamedConnection', { name: config.label || config.model })}
                          tooltip={text('removeConnection')}
                          isDisabled={busy}
                          icon={<Trash2 size={15} />}
                          onClick={event => {
                            event.stopPropagation()
                            const routeId = 'provider:' + config.id
                            const next = configs.filter(item => item.id !== config.id).map(item => item.fallback?.includes(routeId)
                              ? { ...item, fallback: item.fallback.filter(id => id !== routeId) } : item)
                            void run(signal => persist(next, active === config.id ? next[0]?.id ?? '' : active, signal))
                            if (draft.id === config.id) setDraft(settingsPanel === 'models' ? newDraftFor(connectionKind) : newConnection())
                          }}
                        />
                      }
                    />
                  ))}
                </VStack>
              )}
              {settingsPanel === 'models' && (
                <ProviderCatalog
                  disabled={busy}
                  onSelect={model => {
                    setConnectionKind(providerConnectionKind(model))
                    setDraft({ ...newConnection(), provider: model.provider, model: model.model })
                    setModels([])
                    setError('')
                    setFeedback(text(model.access === 'local' ? 'catalogLocalSelected' : 'catalogSelected', { model: model.label }))
                    if (model.access === 'local') modelInput.current?.focus()
                    else keyInput.current?.focus()
                  }}
                />
              )}
              <form onSubmit={saveProvider}>
                <VStack gap={3} className="assistant-form">
                  <Heading level={3}>{text(configs.some(item => item.id === draft.id) ? 'editConnection' : 'addConnection')}</Heading>
                  {settingsPanel === 'models' && (
                    <SegmentedControl
                      label={settingsText('connectionTypes')}
                      value={connectionKind}
                      isDisabled={busy}
                      size="sm"
                      onChange={value => chooseConnectionKind(value as ConnectionKind)}
                    >
                      {connectionKinds.map(kind => (
                        <SegmentedControlItem key={kind} value={kind} label={settingsText('connection_' + kind)} />
                      ))}
                    </SegmentedControl>
                  )}
                  {(!settingsPanel || connectionKind === 'free') && (
                    <>
                      <Selector
                        label={text('freeKeyPresets')}
                        placeholder={text('choosePreset')}
                        isDisabled={busy}
                        width="100%"
                        value={FREE_PRESETS.find(item => item.provider === draft.provider && item.model === draft.model)?.model ?? ''}
                        options={FREE_PRESETS.map(preset => ({ value: preset.model, label: preset.label }))}
                        onChange={value => {
                          const preset = FREE_PRESETS.find(item => item.model === value)
                          if (preset) setProvider(preset.provider, preset.model)
                        }}
                      />
                      <Text type="supporting" color="secondary">{text('freeKeyHint')}</Text>
                    </>
                  )}
                  {(!settingsPanel || connectionKind !== 'free') && (
                    <Selector
                      label={text('providerName')}
                      isDisabled={busy}
                      width="100%"
                      value={draft.provider}
                      options={(Object.keys(PROVIDERS) as ProviderId[])
                        .filter(id => !settingsPanel || Boolean(providerDefinition(id).local) === (connectionKind === 'local'))
                        .map(id => ({ value: id, label: PROVIDERS[id].label }))}
                      onChange={value => setProvider(value as ProviderId)}
                    />
                  )}
                  {allowsProviderEndpoint(draft.provider) && (
                    <TextInput
                      type="url"
                      label={text('apiEndpoint')}
                      placeholder={definition.baseUrl ?? 'https://'}
                      isDisabled={busy}
                      width="100%"
                      value={draft.baseUrl ?? ''}
                      onChange={value => setDraft({ ...draft, baseUrl: value })}
                    />
                  )}
                  <TextInput
                    ref={modelInput}
                    label={text('modelId')}
                    placeholder={text('modelIdPlaceholder')}
                    isDisabled={busy}
                    width="100%"
                    value={draft.model}
                    onChange={value => setDraft({ ...draft, model: value })}
                  />
                  {models.length > 0 && (
                    <Selector
                      label={text('modelId')}
                      isLabelHidden
                      placeholder={text('choosePreset')}
                      isDisabled={busy}
                      size="sm"
                      width="100%"
                      value={models.includes(draft.model) ? draft.model : ''}
                      options={models.map(model => ({ value: model, label: model }))}
                      onChange={value => setDraft({ ...draft, model: value })}
                    />
                  )}
                  <TextInput
                    ref={keyInput}
                    type="password"
                    label={definition.local ? text('optionalLocalKey') : text('apiKey')}
                    autoComplete="off"
                    isDisabled={busy}
                    width="100%"
                    value={draft.apiKey ?? ''}
                    onChange={value => setDraft({ ...draft, apiKey: value })}
                  />
                  {definition.signupUrl && (
                    <Button
                      as="a"
                      variant="ghost"
                      size="sm"
                      href={definition.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      label={text('getProviderKey', { provider: definition.label })}
                      endContent={<ArrowUpRight size={14} />}
                    />
                  )}
                  <FallbackModelSettings
                    routes={allRoutes.filter(route => route.id !== 'provider:' + draft.id)}
                    chain={draft.fallback ?? []}
                    disabled={busy}
                    onChange={fallback => setDraft({ ...draft, fallback })}
                  />
                  <HStack gap={2} wrap="wrap">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      isDisabled={busy}
                      label={text('testConnection')}
                      onClick={() => void run(async signal => {
                        const result = await testProviderConnection(draft, { signal, transport })
                        if (signal.aborted) return
                        setModels(result.models)
                        if (!draft.model && result.models[0]) setDraft({ ...draft, model: result.models[0] })
                        setTelemetry({ key: 'provider:' + draft.id, result: { elapsedMs: result.latencyMs } })
                        setFeedback(text('connectedToProvider', { provider: definition.label }))
                      })}
                    />
                    {(!settingsPanel || connectionKind === 'local') && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        isDisabled={busy}
                        label={text(localProbes ? 'rescanLocalModels' : 'findLocalModels')}
                        onClick={() => void run(async signal => {
                          const results = await probeLocalProviders({ signal, transport })
                          if (signal.aborted) return
                          setLocalProbes(results)
                          setFeedback(text('localDiscoveryComplete'))
                        })}
                      />
                    )}
                    <Button type="submit" variant="primary" size="sm" icon={<Plus size={15} />} isDisabled={busy} label={text('saveConnection')} />
                  </HStack>
                  {localProbes && (!settingsPanel || connectionKind === 'local') && (
                    <LocalProviderDiscovery
                      results={localProbes}
                      disabled={busy}
                      native={!!transport}
                      onSelect={(probe, model) => {
                        setDraft({ id: crypto.randomUUID(), provider: probe.provider, baseUrl: probe.baseUrl, model })
                        setModels(probe.status === 'connected' ? probe.models : [])
                        setFeedback(text('localModelReadyToConfigure', { provider: PROVIDERS[probe.provider].label }))
                        const field = probe.status === 'authorization_needed' ? keyInput : modelInput
                        field.current?.focus()
                      }}
                    />
                  )}
                </VStack>
              </form>
            </VStack>
          ) : editorRequest ? (
            <form onSubmit={generate}>
              <VStack gap={3} className="assistant-form">
                <BotBarModelPicker
                  choices={modelChoices}
                  selected={modelKey}
                  disabled={busy}
                  onChange={pickModel}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined}
                />
                <Text type="supporting" color="secondary">
                  {tab === 'local' || (selected && providerDefinition(selected.provider).local)
                    ? text('localSelection') : selected ? text('remoteSelection', { provider: PROVIDERS[selected.provider].label }) : text('needsModel')}
                </Text>
                {fallbackHint}
                {fallbackStatus}
                {editorRequest.action === 'translate' && (
                  <Selector
                    label={text('language')}
                    isDisabled={busy}
                    width="100%"
                    value={language}
                    options={Object.entries(translationLanguages).map(([code, name]) => ({
                      value: code,
                      label: languageNames.of(code === 'zh' ? 'zh-Hans' : code) ?? name,
                    }))}
                    onChange={value => {
                      setLanguage(value as typeof language)
                      setSuggestion('')
                    }}
                  />
                )}
                <Collapsible trigger={<Text size="sm" weight="semibold">{text('selectedText')}</Text>}>
                  <Text size="sm" color="secondary">{editorRequest.selection.text}</Text>
                </Collapsible>
                {busy && <Text type="supporting" color="secondary" role="status">{text('generating')}</Text>}
                {(reply || suggestion) && (
                  <div className="assistant-selection-result" role="region" aria-label={text('suggestion')}>{reply || suggestion}</div>
                )}
                <HStack gap={2} wrap="wrap">
                  {busy ? (
                    <Button type="button" variant="secondary" icon={<Square size={14} />} label={text('stop')} onClick={stopReply} />
                  ) : (
                    <>
                      <Button type="submit" variant={suggestion ? 'secondary' : 'primary'} isDisabled={!primary} label={text(suggestion ? 'retry' : 'generate')} />
                      {suggestion && (
                        <>
                          <IconButton
                            variant="ghost"
                            size="sm"
                            label={text('copy')}
                            tooltip={text('copy')}
                            icon={<Copy size={15} aria-hidden="true" />}
                            onClick={() => {
                              setError('')
                              setFeedback('')
                              if (!navigator.clipboard) {
                                setError(text('copyFailed'))
                                return
                              }
                              void navigator.clipboard.writeText(suggestion).then(
                                () => setFeedback(text('copied')), () => setError(text('copyFailed')),
                              )
                            }}
                          />
                          {offerReplacement && (
                            <Button type="button" variant={preferInsert ? 'secondary' : 'primary'} label={text('replace')} onClick={() => applySuggestion(false)} />
                          )}
                          <Button type="button" variant={preferInsert ? 'primary' : 'secondary'} label={text('insertAfter')} onClick={() => applySuggestion(true)} />
                        </>
                      )}
                    </>
                  )}
                </HStack>
              </VStack>
            </form>
          ) : (
            <form onSubmit={send}>
              <VStack gap={3} className="assistant-form">
                <BotBarModelPicker
                  choices={modelChoices}
                  selected={modelKey}
                  disabled={busy}
                  onChange={pickModel}
                  telemetry={telemetry?.key === modelKey ? telemetry.result : undefined}
                />
                {tab === 'local' && deviceModel && <Text type="supporting" color="secondary">{desktopText('localModelActive', { model: deviceModel.label })}</Text>}
                {fallbackStatus}
                {messages.length > 0 && (
                  <ol className="assistant-thread" aria-label={text('conversation')}>
                    {messages.map((message, index) => (
                      <li key={index} data-role={message.role}>
                        <Text size="sm">{message.content}</Text>
                        {message.role === 'assistant' && (
                          <Button type="button" variant="secondary" size="sm" label={text('insertInPage')} onClick={() => { onInsert?.(message.content); onClose?.() }} />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {tab === 'local' && busy && !reply && <Text type="supporting" color="secondary" role="status">{desktopText('localModelPreparing')}</Text>}
                {reply && <Text size="sm" role="status">{reply}</Text>}
                <TextArea
                  label={text('prompt')}
                  value={prompt}
                  onChange={value => setPrompt(value.slice(0, 12_000))}
                  rows={3}
                  width="100%"
                  placeholder={text('promptPlaceholder')}
                />
                <CheckboxInput
                  label={text('shareCurrentPage')}
                  value={sharePage}
                  size="sm"
                  onChange={setSharePage}
                />
                {tab !== 'local' && selected && <Text type="supporting" color="secondary">{text('directRequest', { provider: PROVIDERS[selected.provider].label })}</Text>}
                {fallbackHint}
                <HStack gap={2}>
                  {busy ? (
                    <Button type="button" variant="secondary" icon={<Square size={14} />} label={text('stop')} onClick={stopReply} />
                  ) : (
                    <Button type="submit" variant="primary" icon={<Send size={15} />} isDisabled={!primary || !prompt.trim()} label={text('sendPrompt')} />
                  )}
                </HStack>
              </VStack>
            </form>
          )}
        </>
      )}
      {error && (
        <div role="alert">
          <Banner status="error" collapsible={false} title={error} />
        </div>
      )}
      {feedback && (
        <div role="status">
          <Banner status="success" collapsible={false} icon={<Check size={15} />} title={feedback} />
        </div>
      )}
    </VStack>
  )

  if (!onClose) return body

  return (
    <AstryxDialog isOpen onOpenChange={open => { if (!open) onClose() }} className="assistant-dialog" width={600} padding={0}>
      <Layout
        header={<DialogHeader title={dialogTitle} onOpenChange={open => { if (!open) onClose() }} />}
        content={<LayoutContent>{body}</LayoutContent>}
        footer={
          <LayoutFooter hasDivider>
            <HStack justify="end">
              <Button type="button" variant="secondary" label={text('close')} onClick={onClose} />
            </HStack>
          </LayoutFooter>
        }
      />
    </AstryxDialog>
  )
}
