'use client'

import { useRef, useState } from 'react'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import type { CloudImagePolicy } from '@/lib/cloud/image-policy'

export default function CloudImageControl({ policy, onInsert, compact = false }: {
  policy: CloudImagePolicy
  onInsert: (source: string, label: string) => void
  compact?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function add(file: File) {
    if (active.current) return
    active.current = true
    setBusy(true)
    setFailure('')
    try {
      const { prepareCloudImageFile } = await import('@/lib/cloud/prepare-images')
      const source = await prepareCloudImageFile(file, policy)
      if (input.current) onInsert(source, file.name)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not prepare this image.')
    } finally {
      active.current = false
      setBusy(false)
    }
  }

  return <>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,image/x-icon"
      hidden aria-label="Image file" onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void add(file)
      }} />
    <button type="button" className={compact ? 'writer-icon-button' : 'secondary-button'}
      title="Add image" aria-label="Add image" aria-busy={busy} disabled={busy}
      onMouseDown={event => event.preventDefault()} onClick={() => input.current?.click()}>
      {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
      {!compact && ' Add image'}
    </button>
    {failure && <span role="alert" className="account-error">{failure}</span>}
  </>
}
