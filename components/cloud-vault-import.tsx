'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'
import { VaultImportDialog } from './vault-import-dialog'

export default function CloudVaultImport() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const t = useTranslations('cloud-workspace')
  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}><Archive size={16} /> {t('importFiles')}</button>
    {open && <VaultImportDialog cloud onClose={() => { setOpen(false); router.refresh() }}
      onOpenPage={id => { setOpen(false); router.push('/page/' + id) }} />}
  </>
}
