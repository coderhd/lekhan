'use client'

import { useRef, useState } from 'react'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import { CloudImageError, PAID_IMAGE_BYTES, type CloudImagePolicy } from '@/lib/cloud/image-policy'
import { useTranslations } from '@/lib/i18n/client'

export default function CloudImageControl({ policy, onInsert, compact = false }: {
  policy: CloudImagePolicy
  onInsert: (source: string, label: string) => void
  compact?: boolean
}) {
  const t = useTranslations('editor-chrome')
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CloudImageError['code'] | 'imagePrepareFailed' | null>(null)

  async function add(file: File) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setFailure(null)
    try {
      const { prepareCloudImageFile } = await import('@/lib/cloud/prepare-images')
      const source = await prepareCloudImageFile(file, policy)
      if (input.current) onInsert(source, file.name)
    } catch (error) {
      setFailure(error instanceof CloudImageError ? error.code : 'imagePrepareFailed')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  return <>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/x-icon"
      hidden aria-label={t('imageFile')} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void add(file)
      }} />
    <button type="button" className={compact ? 'writer-icon-button' : 'secondary-button'}
      title={t('addImage')} aria-label={t('addImage')} aria-busy={busy} disabled={busy}
      onMouseDown={event => event.preventDefault()} onClick={() => input.current?.click()}>
      {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
      {!compact && <> {t('addImage')}</>}
    </button>
    {failure && <span role="alert" className="account-error">
      {failure === 'imageTooLarge' ? t(failure, { limit: PAID_IMAGE_BYTES / 1_000_000 }) : t(failure)}
    </span>}
  </>
}
