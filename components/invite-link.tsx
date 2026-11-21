'use client'

import { useRef, useState } from 'react'

export default function InviteLink({ path, origin }: { path: string; origin: string | null }) {
  const [result, setResult] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function copy() {
    const url = new URL(path, origin ?? window.location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      setResult('Copied')
    } catch {
      if (input.current) input.current.value = url
      input.current?.focus()
      input.current?.select()
      setResult('Select and copy the invitation link.')
    }
  }

  return <div className="invite-link">
    <input ref={input} readOnly aria-label="Invitation link" defaultValue={origin ? new URL(path, origin).href : path} />
    <button type="button" className="secondary-button" onClick={copy}>Copy link</button>
    <span role="status">{result}</span>
  </div>
}
