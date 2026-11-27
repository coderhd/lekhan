'use client'

import { Cpu } from 'lucide-react'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { useTranslations } from '@/lib/i18n/client'
import { usageTokenCount } from '@/lib/ai/editor-actions'
import type { Usage } from '@/lib/ai/client'

export type ModelTelemetry = { elapsedMs: number; usage?: Usage }

export default function BotBarModelPicker({ choices, selected, disabled, telemetry, onChange }: {
  choices: readonly { id: string; label: string }[]
  selected: string
  disabled: boolean
  telemetry?: ModelTelemetry
  onChange: (value: string) => void
}) {
  const t = useTranslations('editor-ai')
  const tokens = usageTokenCount(telemetry?.usage)

  return (
    <VStack gap={1} className="bot-bar-model">
      <Selector
        label={t('model')}
        startIcon={<Cpu size={15} aria-hidden="true" />}
        placeholder={t('needsModel')}
        isDisabled={disabled || !choices.length}
        width="100%"
        value={choices.length ? selected : ''}
        options={choices.map(choice => ({ value: choice.id, label: choice.label }))}
        onChange={onChange}
      />
      {telemetry && (
        <Text type="supporting" color="secondary" className="bot-bar-telemetry">
          {tokens === undefined ? t('tokensUnavailable') : t('tokens', { count: tokens })} · {t('latency', { milliseconds: telemetry.elapsedMs })}
        </Text>
      )}
    </VStack>
  )
}
