'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { VaultImportDialog } from './vault-import-dialog'

export default function CloudVaultImport() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}><Archive size={16} /> Import files</button>
    {open && <VaultImportDialog cloud onClose={() => { setOpen(false); router.refresh() }}
      onOpenPage={id => { setOpen(false); router.push('/page/' + id) }} />}
  </>
}
