import { invoke } from '@tauri-apps/api/core'
import { Check, Plus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Dialog } from '../components/workspace-dialogs'
import type { LocalLibrary, LocalModel } from './local-models'

export default function ModelLibrary({ library, selected, onSelect, refresh, onClose }: {
  library?: LocalLibrary; selected: string | null; onSelect: (id: string | null) => void
  refresh: () => Promise<LocalLibrary | undefined>; onClose: () => void
}) {
  const t = useTranslations('desktop')
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<LocalModel>()

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
  }

  async function removeModel(model: LocalModel) {
    await invoke('remove_local_model', { id: model.id })
    if (model.id === selected) onSelect(null)
    await refresh()
    setRemoving(undefined)
  }

  function formatSize(bytes: number) {
    const unit = bytes >= 1024 ** 3 ? 'GiB' : 'MiB'
    const size = bytes / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2)
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size) + ' ' + unit
  }

  return <Dialog title={t('modelLibrary')} className="assistant-dialog" onClose={onClose}>
    <div className="form-dialog">
      <h2>{t('modelLibrary')}</h2>
      <p>{t('localModelDescription')}</p>
      {!library ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => {
        if (!await refresh()) throw new Error(t('modelLibraryError'))
      })}>{t('modelLibraryRetry')}</button> : !library.runtimeAvailable && <p role="status">{t('localRuntimeUnavailable')}</p>}
      {!!library?.models.length && <ul className="assistant-connections">
        {library.models.map(model => <li key={model.id}>
          <button className="connection-name" type="button" aria-pressed={selected === model.id}
            disabled={busy || !library.runtimeAvailable} onClick={() => onSelect(model.id)}>
            {selected === model.id && <Check size={14} aria-hidden="true" />} {model.label} <small>{formatSize(model.bytes)}</small>
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setRemoving(model)}>{t('removeLocalModel')}</button>
        </li>)}
      </ul>}
      {removing && <div className="local-model-remove">
        <p>{t('confirmRemoveModel', { model: removing.label })}</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setRemoving(undefined)}>{t('cancelModelAction')}</button>
          <button className="danger-button" type="button" disabled={busy} onClick={() => void run(() => removeModel(removing))}>{t('removeLocalModel')}</button>
        </div>
      </div>}
      {error && <p className="account-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onClose}>{t('closeModels')}</button>
        <button className="primary-button" type="button" disabled={busy || !library?.runtimeAvailable} onClick={() => void run(importModel)}>
          <Plus size={16} aria-hidden="true" /> {busy ? t('workingWithModels') : t('importLocalModel')}
        </button>
      </div>
    </div>
  </Dialog>
}
