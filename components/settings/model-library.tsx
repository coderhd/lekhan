import { invoke } from '@tauri-apps/api/core'
import { ArrowDownToLine, ArrowUpRight, Check, Plus, Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Dialog } from '../workspace-dialogs'
import type { CatalogModel, LocalLibrary, LocalModel } from '../../desktop/local-models'

export default function ModelLibrary({ library, selected, onSelect, refresh, onClose }: {
  library?: LocalLibrary; selected: string | null; onSelect: (id: string | null) => void
  refresh: () => Promise<LocalLibrary | undefined>; onClose?: () => void
}) {
  const t = useTranslations('desktop')
  const locale = useLocale()
  const [tab, setTab] = useState<'discover' | 'installed'>(selected ? 'installed' : 'discover')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<{ model: LocalModel; partial: boolean }>()

  useEffect(() => {
    const timer = setInterval(() => { void refresh() }, 900)
    return () => clearInterval(timer)
  }, [refresh])

  async function run(work: () => Promise<void>) {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (error) {
      setError(typeof error === 'string' ? error : t('modelLibraryError'))
    } finally {
      setBusy(false)
    }
  }

  async function importModel() {
    const model = await invoke<LocalModel | null>('import_local_model')
    if (!model) return
    await refresh()
    onSelect(model.id)
    setTab('installed')
  }

  async function removeModel(model: LocalModel, partial: boolean) {
    await invoke(partial ? 'discard_model_download' : 'remove_local_model', { id: model.id })
    if (!partial && model.id === selected) onSelect(null)
    await refresh()
    setRemoving(undefined)
  }

  async function transfer(model: CatalogModel, command: 'download_local_model' | 'pause_model_download') {
    await invoke(command, { id: model.id })
    await refresh()
  }

  function formatSize(bytes: number) {
    const unit = bytes >= 1024 ** 3 ? 'GiB' : 'MiB'
    const size = bytes / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size) + ' ' + unit
  }

  function renderRemoval(model: LocalModel, partial: boolean) {
    if (removing?.model.id !== model.id || removing.partial !== partial) return null

    return <div className="local-model-remove">
      <p>{t(partial ? 'confirmDiscardModel' : 'confirmRemoveModel', { model: model.label })}</p>
      <div className="dialog-actions">
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setRemoving(undefined)}>{t('cancelModelAction')}</button>
        <button className="danger-button" type="button" disabled={busy} onClick={() => void run(() => removeModel(model, partial))}>{t(partial ? 'discardPartialModel' : 'removeLocalModel')}</button>
      </div>
    </div>
  }

  function renderCatalog(model: CatalogModel) {
    const installed = library?.models.some(item => item.id === model.id)
    const capacity = library?.capacity
    const needsMemory = capacity?.totalMemory != null && model.memory > capacity.totalMemory
    const needsDisk = capacity?.freeDisk != null && model.bytes - model.downloaded > capacity.freeDisk
    const hasRoom = !!library?.runtimeAvailable && capacity?.totalMemory != null && capacity.freeDisk != null && !needsMemory && !needsDisk
    const active = ['downloading', 'verifying', 'pausing'].includes(model.phase)
    const progressing = active || model.downloaded > 0
    const progress = t('modelProgress', { downloaded: formatSize(model.downloaded), total: formatSize(model.bytes) })

    return <li className="model-catalog-row" key={model.id}>
      <div className="model-catalog-heading">
        <h3>{model.label}</h3>
        <a className="icon-button" href={'https://huggingface.co/' + model.repository} target="_blank" rel="noopener noreferrer"
          aria-label={t('openModelSource', { model: model.label })}><ArrowUpRight size={16} /></a>
      </div>
      <p className="model-catalog-description">{t('modelStrength_' + model.strength)}</p>
      <p className="model-catalog-meta">{formatSize(model.bytes)} · Q4_K_M · {t('modelMemoryEstimate', { memory: formatSize(model.memory) })}</p>
      {!installed && !active && hasRoom && <p className="model-catalog-fit"><Check size={14} aria-hidden="true" /> {t('fitsDevice')}</p>}
      {!installed && progressing && <div className="model-download-progress">
        <progress max={model.bytes} value={model.downloaded} aria-label={t('modelDownloadProgress', { model: model.label })} />
        <small>{model.phase === 'verifying' ? t('verifyingModel') : model.phase === 'pausing' ? t('pausingModel') : progress}</small>
      </div>}
      {!installed && model.error && <p className="account-error" role="status">{t('modelTransferError_' + model.error)}</p>}
      {!installed && !active && (needsMemory || needsDisk) && <p className="model-catalog-meta">{t(needsMemory ? 'lowModelMemory' : 'lowModelDisk')}</p>}
      <div className="model-row-actions">
        {installed ? <button className="secondary-button" type="button" onClick={() => setTab('installed')}>
          <Check size={15} /> {t('modelInstalledBadge')}
        </button> : active ? <button className="secondary-button" type="button" disabled={busy || model.phase === 'pausing'}
          onClick={() => void run(() => transfer(model, 'pause_model_download'))}>{t('pauseModelDownload')}</button>
          : <button className="secondary-button" type="button" disabled={busy || !library?.runtimeAvailable || needsMemory || needsDisk}
            onClick={() => void run(() => transfer(model, 'download_local_model'))}>
            <ArrowDownToLine size={16} /> {t(model.downloaded ? 'resumeModelDownload' : 'downloadModel')}
          </button>}
        {!installed && !active && model.downloaded > 0 && <button className="secondary-button" type="button" disabled={busy}
          onClick={() => setRemoving({ model, partial: true })}>{t('discardPartialModel')}</button>}
      </div>
      {!installed && !active && model.downloaded > 0 && renderRemoval(model, true)}
    </li>
  }

  const matching = library?.catalog.filter(model => model.label.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))) ?? []
  const used = library?.models.reduce((total, model) => total + model.bytes, 0) ?? 0

  const content = <div className={onClose ? 'form-dialog' : 'form-dialog embedded-model-library'}>
      <h2>{t('modelLibrary')}</h2>
      <p>{t('localModelDescription')}</p>
      {!library ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => {
        if (!await refresh()) throw new Error(t('modelLibraryError'))
      })}>{t('modelLibraryRetry')}</button> : !library.runtimeAvailable && <p role="status">{t('localRuntimeUnavailable')}</p>}
      <div className="assistant-navigation" role="group" aria-label={t('modelLibrary')}>
        <button className="secondary-button" type="button" aria-pressed={tab === 'discover'} onClick={() => setTab('discover')}>{t('discoverModels')}</button>
        <button className="secondary-button" type="button" aria-pressed={tab === 'installed'} onClick={() => setTab('installed')}>{t('installedModels')}</button>
      </div>
      {tab === 'discover' ? <>
        <label className="model-catalog-search"><Search size={16} aria-hidden="true" />
          <input value={query} type="search" onChange={event => setQuery(event.target.value)}
            placeholder={t('searchModels')} aria-label={t('searchModels')} />
        </label>
        {!!matching.length && <ul className="model-catalog">{matching.map(renderCatalog)}</ul>}
        {library && !matching.length && <p>{t('noMatchingModels')}</p>}
      </> : <>
        <p className="model-catalog-meta">{t('modelStorageUsed', { used: formatSize(used) })}
          {library?.capacity.freeDisk != null && ' · ' + t('modelStorageFree', { free: formatSize(library.capacity.freeDisk) })}
        </p>
        {!!library?.models.length && <ul className="assistant-connections">
          {library.models.map(model => <li key={model.id}>
            <button className="connection-name" type="button" aria-pressed={selected === model.id}
              disabled={busy || !library.runtimeAvailable} onClick={() => onSelect(model.id)}>
              {selected === model.id && <Check size={14} aria-hidden="true" />} {model.label} <small>{formatSize(model.bytes)}</small>
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setRemoving({ model, partial: false })}>{t('removeLocalModel')}</button>
          </li>)}
        </ul>}
        {removing && library?.models.some(model => model.id === removing.model.id) && renderRemoval(removing.model, false)}
      </>}
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {onClose && <button className="secondary-button" type="button" onClick={onClose}>{t('closeModels')}</button>}
        <button className="primary-button" type="button" disabled={busy || !library?.runtimeAvailable} onClick={() => void run(importModel)}>
          <Plus size={16} aria-hidden="true" /> {busy ? t('workingWithModels') : t('importLocalModel')}
        </button>
      </div>
    </div>
  return onClose ? <Dialog title={t('modelLibrary')} className="assistant-dialog model-library-dialog" onClose={onClose}>{content}</Dialog> : content
}
