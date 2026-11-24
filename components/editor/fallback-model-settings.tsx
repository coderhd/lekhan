import { ArrowDown, ArrowUp, X } from 'lucide-react'
import type { ModelRoute } from '@/lib/ai/fallback'
import { MAX_FALLBACK_MODELS } from '@/lib/ai/provider-registry'
import { useTranslations } from '@/lib/i18n/client'

export default function FallbackModelSettings({ routes, chain, disabled, onChange }: {
  routes: readonly ModelRoute[]
  chain: readonly string[]
  disabled: boolean
  onChange: (chain: string[]) => void
}) {
  const t = useTranslations('editor-ai')
  const available = routes.filter(route => !chain.includes(route.id))

  function move(index: number, offset: -1 | 1) {
    const reordered = [...chain]
    const [item] = reordered.splice(index, 1)
    reordered.splice(index + offset, 0, item)
    onChange(reordered)
  }

  return <details className="fallback-settings" open={chain.length ? true : undefined}>
    <summary>{t('fallbackSettings')}</summary>
    <p>{t('fallbackSettingsHint')}</p>
    {chain.length > 0 && <ol className="fallback-list">
      {chain.map((id, index) => {
        const label = routes.find(route => route.id === id)?.label ?? t('fallbackUnavailable')
        return <li key={id}><div className="fallback-row">
          <span>{label}</span>
          <div>
            <button type="button" className="icon-button" aria-label={t('moveFallbackUp', { model: label })}
              disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-button" aria-label={t('moveFallbackDown', { model: label })}
              disabled={disabled || index === chain.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
            <button type="button" className="icon-button" aria-label={t('removeFallback', { model: label })}
              disabled={disabled} onClick={() => onChange(chain.filter(candidate => candidate !== id))}><X size={15} aria-hidden="true" /></button>
          </div>
        </div></li>
      })}
    </ol>}
    {available.length > 0 && chain.length < MAX_FALLBACK_MODELS && <label>{t('addFallback')}
      <select value="" disabled={disabled} onChange={event => {
        if (event.target.value) onChange([...chain, event.target.value])
      }}>
        <option value="">{t('chooseFallback')}</option>
        {available.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}
      </select>
    </label>}
  </details>
}
