'use client'

import { useRef, useState } from 'react'
import { useTranslations } from '@/lib/i18n/client'

export default function InviteLink({ path, origin, label }: {
  path: string; origin: string | null; label?: string
}) {
  const t = useTranslations('cloud-workspace')
  const [result, setResult] = useState<'copied' | 'copyManually' | null>(null)
  const input = useRef<HTMLInputElement>(null)
  async function copy() {
    const url = new URL(path, origin ?? window.location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      setResult('copied')
    } catch {
      if (input.current) input.current.value = url
      input.current?.focus()
      input.current?.select()
      setResult('copyManually')
    }
  }

  return <div className="invite-link">
    <input ref={input} readOnly aria-label={label ?? t('invitationLink')} defaultValue={origin ? new URL(path, origin).href : path} />
    <button type="button" className="secondary-button" onClick={copy}>{t('copyLink')}</button>
    <span role="status">{result && t(result)}</span>
  </div>
}
