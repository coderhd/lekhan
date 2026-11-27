'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { uuidPattern } from '@/lib/cloud/graph'
import { forgetCloudSearchPage } from '@/lib/cloud/local-search'

export function DiscardOfflineAccess({ subject }: { subject: string }) {
  const pathname = usePathname()
  useEffect(() => {
    const id = pathname.split('/').filter(Boolean).at(-1)
    if (id && uuidPattern.test(id)) void forgetCloudSearchPage(subject, id).catch(() => undefined)
  }, [pathname, subject])
  return null
}

export function PrepareOfflineWorkspace() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/cloud-offline-worker.js', { updateViaCache: 'none' })
      .then(registration => registration.active?.postMessage('prepare-cloud-offline'))
      .catch(() => undefined)
  }, [])
  return null
}
