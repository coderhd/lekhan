'use client'

import { useActionState, useState } from 'react'
import { saveDisplayName } from '@/app/settings/actions'
import { useTranslations } from '@/lib/i18n/client'

export type SettingsProfile = { subject: string; email: string | null; displayName: string }

export default function ProfileSettings({ profile }: { profile: SettingsProfile }) {
  const t = useTranslations('settings')
  const [result, save, pending] = useActionState(saveDisplayName, {})
  const [name, setName] = useState(profile.displayName)
  return <form className="settings-fields" action={save}>
    <input type="hidden" name="subject" value={profile.subject} />
    <label>{t('displayName')}<input name="display-name" maxLength={100} value={name} autoComplete="name"
      onChange={event => setName(event.target.value)} /></label>
    {profile.email && <div><strong>{t('accountEmail')}</strong><p>{profile.email}</p></div>}
    <button className="primary-button" disabled={pending}>{t('saveProfile')}</button>
    {result.outcome && <p role={result.outcome === 'saved' ? 'status' : 'alert'}>
      {t(result.outcome === 'saved' ? 'profileSaved' : 'profileSaveFailed')}
    </p>}
  </form>
}
