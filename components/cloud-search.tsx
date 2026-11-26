'use client'

import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslations } from '@/lib/i18n/client'
import { SearchDialog } from './workspace-dialogs'

export default function CloudSearch({ subject, offline = false, onOpen }: {
  subject: string
  offline?: boolean
  onOpen?: (id: string) => void
}) {
  const t = useTranslations('app-shell')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function toggle(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(previous => !previous)
      }
    }
    window.addEventListener('keydown', toggle)
    return () => window.removeEventListener('keydown', toggle)
  }, [])

  return <>
    <button className="secondary-button cloud-search-trigger" type="button" onClick={() => setOpen(true)}>
      <Search size={15} aria-hidden="true" /> {t('searchPages')} <kbd aria-hidden="true">⌘ K</kbd>
    </button>
    {open && <SearchDialog cloudSubject={subject} offlineOnly={offline} onClose={() => setOpen(false)} onOpenCloud={id => {
      setOpen(false)
      if (onOpen) onOpen(id)
      else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const target = new URL('/cloud-offline', window.location.origin)
        target.searchParams.set('page', id)
        window.location.assign(target.href)
      } else router.push('/page/' + id)
    }} />}
  </>
}
