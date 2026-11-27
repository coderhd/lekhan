import { invoke } from '@tauri-apps/api/core'
import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Banner } from '@astryxdesign/core/Banner'
import { Dialog as AstryxDialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Item } from '@astryxdesign/core/Item'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'

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
  return (
    <VStack gap={1} className="desktop-update-controls">
      {update.status === 'available' ? (
        <Item
          density="compact"
          startContent={<Download size={15} aria-hidden="true" />}
          label={text('updateInstall', { version: update.version })}
          isDisabled={!canInstall || installing}
          onClick={() => void install()}
        />
      ) : (
        <Item
          density="compact"
          startContent={<RefreshCw size={15} aria-hidden="true" />}
          label={text(checking ? 'updateChecking' : 'updateCheck')}
          isDisabled={checking}
          onClick={() => void check()}
        />
      )}
      {error ? (
        <div role="alert"><Banner status="error" collapsible={false} title={text('updateError_' + error)} /></div>
      ) : checkedByUser && update.status === 'current' && (
        <Text type="supporting" role="status" color="secondary">{text('updateCurrent')}</Text>
      )}
    </VStack>
  )
}

export function DesktopUpdateProgress({ installing }: { installing: boolean }) {
  const text = useTranslations('desktop')
  if (!installing) return null
  return (
    <AstryxDialog isOpen onOpenChange={() => undefined} purpose="required" width={420} padding={0}>
      <Layout
        header={<DialogHeader title={text('updateTitle')} />}
        content={<LayoutContent><Text role="status">{text('updateInstalling')}</Text></LayoutContent>}
      />
    </AstryxDialog>
  )
}
