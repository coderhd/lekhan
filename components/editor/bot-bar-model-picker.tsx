import { useId } from 'react'
import { Cpu } from 'lucide-react'
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
  const id = useId()
  const tokens = usageTokenCount(telemetry?.usage)

  return <div className="bot-bar-model">
    <label htmlFor={id}><span><Cpu size={15} aria-hidden="true" /> {t('model')}</span></label>
    <select id={id} value={selected} disabled={disabled || !choices.length} onChange={event => onChange(event.target.value)}>
      {!choices.length && <option value="">{t('needsModel')}</option>}
      {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select>
    {telemetry && <small className="bot-bar-telemetry">
      {tokens === undefined ? t('tokensUnavailable') : t('tokens', { count: tokens })} · {t('latency', { milliseconds: telemetry.elapsedMs })}
    </small>}
  </div>
}
