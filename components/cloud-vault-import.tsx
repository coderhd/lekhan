'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { useTranslations } from '@/lib/i18n/client'
import { VaultImportDialog } from './vault-import-dialog'

export default function CloudVaultImport() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const t = useTranslations('cloud-workspace')
  return <>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      icon={<Archive size={16} aria-hidden="true" />}
      label={t('importFiles')}
      onClick={() => setOpen(true)}
    />
    {open && <VaultImportDialog cloud onClose={() => { setOpen(false); router.refresh() }}
      onOpenPage={id => { setOpen(false); router.push('/page/' + id) }} />}
  </>
}
