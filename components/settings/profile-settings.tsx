'use client'

import { useActionState, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { saveDisplayName } from '@/app/settings/actions'
import { useTranslations } from '@/lib/i18n/client'

export type SettingsProfile = { subject: string; email: string | null; displayName: string }

export default function ProfileSettings({ profile }: { profile: SettingsProfile }) {
  const t = useTranslations('settings')
  const [result, save, pending] = useActionState(saveDisplayName, {})
  const [name, setName] = useState(profile.displayName)
  return (
    <form action={save}>
      <VStack gap={3} align="start" className="settings-fields">
        <input type="hidden" name="subject" value={profile.subject} />
        <TextInput
          label={t('displayName')}
          htmlName="display-name"
          autoComplete="name"
          width="100%"
          value={name}
          onChange={value => setName(value.slice(0, 100))}
        />
        {profile.email && (
          <VStack gap={0.5}>
            <Text type="label" weight="semibold">{t('accountEmail')}</Text>
            <Text color="secondary">{profile.email}</Text>
          </VStack>
        )}
        <Button type="submit" variant="primary" isLoading={pending} label={t('saveProfile')} />
        {result.outcome && (
          <div role={result.outcome === 'saved' ? 'status' : 'alert'} style={{ width: '100%' }}>
            <Banner
              status={result.outcome === 'saved' ? 'success' : 'error'}
              collapsible={false}
              title={t(result.outcome === 'saved' ? 'profileSaved' : 'profileSaveFailed')}
            />
          </div>
        )}
      </VStack>
    </form>
  )
}
