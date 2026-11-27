'use client'

import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useTranslations } from '@/lib/i18n/client'

export default function InviteLink({ path, origin, label }: {
  path: string; origin: string | null; label?: string
}) {
  const t = useTranslations('cloud-workspace')
  const [result, setResult] = useState<'copied' | 'copyManually' | null>(null)
  const initial = origin ? new URL(path, origin).href : path

  async function copy() {
    const url = new URL(path, origin ?? window.location.origin).href
    try {
      await navigator.clipboard.writeText(url)
      setResult('copied')
    } catch {
      setResult('copyManually')
    }
  }

  return (
    <VStack gap={1.5} className="invite-link">
      <HStack gap={2} align="end" wrap="wrap">
        <TextInput
          label={label ?? t('invitationLink')}
          isLabelHidden
          isReadOnly
          value={initial}
          width="100%"
        />
        <Button type="button" variant="secondary" size="sm" label={t('copyLink')} onClick={copy} />
      </HStack>
      {result && <Text type="supporting" role="status">{t(result)}</Text>}
    </VStack>
  )
}
