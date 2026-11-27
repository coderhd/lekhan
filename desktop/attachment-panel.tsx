import { invoke } from '@tauri-apps/api/core'
import { ArrowDownToLine, Paperclip } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Item } from '@astryxdesign/core/Item'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import type { Page } from '../lib/types'
import { rasterMime } from '../lib/vault-import'
import { attachmentMarkdown, maxAttachment, referencedAttachments, type VaultAttachment } from './vault-attachments'
import type { VaultAsset } from './vault-storage'

function readBytes(token: string, path: string) {
  return invoke<ArrayBuffer>('read_vault_attachment', { token, path })
}

function Attachment({ token, asset }: { token: string; asset: VaultAttachment }) {
  const t = useTranslations('desktop')
  const [image, setImage] = useState<string>()
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = useRef<HTMLLIElement>(null)

  useEffect(() => {
    const element = target.current
    if (!element || !asset.preview || asset.bytes > maxAttachment) return
    let active = true
    let url: string | undefined
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void readBytes(token, asset.path).then(buffer => {
        const mime = rasterMime(new Uint8Array(buffer))
        if (!active || !mime) return
        url = URL.createObjectURL(new Blob([buffer], { type: 'image/' + mime }))
        setImage(url)
      }).catch(() => undefined)
    })
    observer.observe(element)
    return () => {
      active = false
      observer.disconnect()
      if (url) URL.revokeObjectURL(url)
    }
  }, [token, asset.path, asset.preview, asset.bytes])

  async function download() {
    setDownloading(true)
    setFailed(false)
    try {
      const buffer = await readBytes(token, asset.path)
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url
      link.download = asset.path.split('/').at(-1) ?? 'Attachment'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return <li ref={target} className="vault-attachment">
    <VStack gap={1}>
      {/* eslint-disable-next-line @next/next/no-img-element -- The desktop preview is a local blob. */}
      {image && <img src={image} alt={asset.label} loading="lazy" />}
      <Item
        density="compact"
        startContent={<ArrowDownToLine size={14} aria-hidden="true" />}
        label={asset.label}
        isDisabled={downloading || asset.bytes > maxAttachment}
        onClick={() => void download()}
      />
      {asset.bytes > maxAttachment && <Text type="supporting" color="secondary" className="vault-attachment-status">{t('attachmentLimit')}</Text>}
      {failed && <Text type="supporting" className="vault-attachment-status" role="alert">{t('attachmentReadFailed')}</Text>}
    </VStack>
  </li>
}

export default function AttachmentPanel({ token, page, path, assets, onAttach, onInsert }: {
  token: string; page: Page; path: string; assets: VaultAsset[]
  onAttach: (path: string) => void; onInsert?: (markdown: string) => void
}) {
  const t = useTranslations('desktop')
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState(false)
  const linked = useMemo(() => referencedAttachments(page.markdown, path, assets), [page.markdown, path, assets])

  async function add() {
    if (!onInsert || adding) return
    setAdding(true)
    setFailed(false)
    try {
      const added = await invoke<string | null>('attach_vault_file', { token })
      if (added) {
        onAttach(added)
        onInsert(attachmentMarkdown(added, path))
      }
    } catch {
      setFailed(true)
    } finally {
      setAdding(false)
    }
  }

  return <section className="context-section" aria-label={t('attachments')}>
    <h3><Paperclip size={16} /> {t('attachments')}</h3>
    {linked.length > 0 && <ul className="vault-attachment-list">
      {linked.map(asset => <Attachment key={asset.path + ':' + asset.modifiedMs + ':' + asset.preview} token={token} asset={asset} />)}
    </ul>}
    <Button
      type="button"
      variant="secondary"
      size="sm"
      width="100%"
      icon={<Paperclip size={14} aria-hidden="true" />}
      isDisabled={!onInsert || !path || adding}
      label={t('attachFile')}
      onClick={() => void add()}
    />
    {failed && <Text type="supporting" className="vault-attachment-status" role="alert">{t('attachmentAddFailed')}</Text>}
  </section>
}
