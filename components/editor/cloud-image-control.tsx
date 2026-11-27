'use client'

import { useRef, useState } from 'react'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
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
    {compact ? (
      <IconButton
        variant="ghost"
        size="sm"
        label={t('addImage')}
        tooltip={t('addImage')}
        isDisabled={busy}
        aria-busy={busy}
        icon={busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
        onMouseDown={event => event.preventDefault()}
        onClick={() => input.current?.click()}
      />
    ) : (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        isLoading={busy}
        isDisabled={busy}
        icon={<ImagePlus size={16} aria-hidden="true" />}
        label={t('addImage')}
        onMouseDown={event => event.preventDefault()}
        onClick={() => input.current?.click()}
      />
    )}
    {failure && (
      <Text role="alert" type="supporting" className="account-error">
        {failure === 'imageTooLarge' ? t(failure, { limit: PAID_IMAGE_BYTES / 1_000_000 }) : t(failure)}
      </Text>
    )}
  </>
}
