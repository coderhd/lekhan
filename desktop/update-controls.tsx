import { invoke } from '@tauri-apps/api/core'
import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog } from '@/components/workspace-dialogs'

type UpdateStatus = { status: 'disabled' | 'current' } | { status: 'available'; version: string }

export function useDesktopUpdates() {
  const [update, setUpdate] = useState<UpdateStatus>({ status: 'disabled' })
  const [checking, setChecking] = useState(false)
  const [checkedByUser, setCheckedByUser] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<'' | 'checkFailed' | 'installFailed' | 'closeCloud' | 'versionChanged'>('')

  useEffect(() => {
    let live = true
    void invoke<UpdateStatus>('check_for_app_update').then(status => {
      if (live && status) setUpdate(status)
    }).catch(() => {
      if (!live) return
      setUpdate({ status: 'current' })
      setError('checkFailed')
    })
    return () => { live = false }
  }, [])

  async function check() {
    setError('')
    setChecking(true)
    try {
      setUpdate(await invoke<UpdateStatus>('check_for_app_update'))
      setCheckedByUser(true)
    } catch {
      setError('checkFailed')
    } finally {
      setChecking(false)
    }
  }

  async function install() {
    if (update.status !== 'available' || installing) return
    setError('')
    setInstalling(true)
    try {
      await invoke('install_app_update', { version: update.version })
    } catch (failure) {
      if (failure === 'version_changed') {
        setUpdate({ status: 'current' })
        setError('versionChanged')
      } else {
        setError(failure === 'close_cloud' ? 'closeCloud' : 'installFailed')
      }
    } finally {
      setInstalling(false)
    }
  }

  return { update, checking, checkedByUser, installing, error, check, install }
}

export function DesktopUpdateControls({ updates, canInstall }: { updates: ReturnType<typeof useDesktopUpdates>; canInstall: boolean }) {
  const text = useTranslations('desktop')
  const { update, checking, checkedByUser, installing, error, check, install } = updates

  if (update.status === 'disabled') return null
  return <div className="desktop-update-controls">
    {update.status === 'available'
      ? <button className="nav-action" type="button" disabled={!canInstall || installing} onClick={() => void install()}>
        <Download size={15} aria-hidden="true" /> {text('updateInstall', { version: update.version })}
      </button>
      : <button className="nav-action" type="button" disabled={checking} onClick={() => void check()}>
        <RefreshCw size={15} aria-hidden="true" /> {text(checking ? 'updateChecking' : 'updateCheck')}
      </button>}
    {error ? <p role="alert">{text('updateError_' + error)}</p>
      : checkedByUser && update.status === 'current' && <p role="status">{text('updateCurrent')}</p>}
  </div>
}

export function DesktopUpdateProgress({ installing }: { installing: boolean }) {
  const text = useTranslations('desktop')
  if (!installing) return null
  return <Dialog className="assistant-dialog" title={text('updateTitle')} onClose={() => undefined}>
    <div className="form-dialog">
      <h2>{text('updateTitle')}</h2>
      <p role="status">{text('updateInstalling')}</p>
    </div>
  </Dialog>
}
