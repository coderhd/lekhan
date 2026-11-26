import { ArrowUpRight, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { filterModels } from '@/lib/ai/model-catalog'
import { PROVIDERS } from '@/lib/ai/provider-registry'
import type { ModelAccess, ModelCapability, ModelCard, ModelFilters, ModelHardware } from '@/lib/ai/types'
import { useLocale, useTranslations } from '@/lib/i18n/client'

export default function ProviderCatalog({ disabled, onSelect }: {
  disabled: boolean
  onSelect: (model: ModelCard) => void
}) {
  const text = useTranslations('editor-ai')
  const locale = useLocale()
  const [filters, setFilters] = useState<ModelFilters>({})
  const models = filterModels(filters)
  const tokens = new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 })

  return <details className="provider-catalog">
    <summary>{text('catalogTitle')} <ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="provider-catalog-content">
      <label className="provider-catalog-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" aria-label={text('catalogSearch')} placeholder={text('catalogSearch')}
          value={filters.query ?? ''} onChange={event => setFilters({ ...filters, query: event.target.value })} />
      </label>
      <div className="provider-catalog-filters">
        <label>{text('catalogCost')}
          <select value={filters.access ?? ''} onChange={event => setFilters({ ...filters, access: (event.target.value as ModelAccess | '') || undefined })}>
            <option value="">{text('catalogAny')}</option>
            <option value="free">{text('catalogFree')}</option>
            <option value="byok">{text('catalogByok')}</option>
            <option value="local">{text('catalogLocal')}</option>
          </select>
        </label>
        <label>{text('catalogRunsOn')}
          <select value={filters.locality ?? ''} onChange={event => {
            const locality = event.target.value as ModelFilters['locality'] | ''
            setFilters({ ...filters, locality: locality || undefined, hardware: locality === 'cloud' ? undefined : filters.hardware })
          }}>
            <option value="">{text('catalogAny')}</option>
            <option value="device">{text('catalogDevice')}</option>
            <option value="cloud">{text('catalogCloud')}</option>
          </select>
        </label>
        <label>{text('catalogHardware')}
          <select disabled={filters.locality === 'cloud'} value={filters.hardware ?? ''}
            onChange={event => setFilters({ ...filters, hardware: (event.target.value as ModelHardware | '') || undefined })}>
            <option value="">{text('catalogAny')}</option>
            <option value="compact">{text('catalogCompact')}</option>
            <option value="standard">{text('catalogStandard')}</option>
          </select>
        </label>
        <label>{text('catalogContext')}
          <select value={filters.minContextTokens ?? 0} onChange={event => setFilters({ ...filters, minContextTokens: Number(event.target.value) })}>
            <option value="0">{text('catalogAny')}</option>
            {[32_000, 128_000, 1_000_000].map(count => <option key={count} value={count}>
              {text('catalogMinimum', { tokens: tokens.format(count) })}
            </option>)}
          </select>
        </label>
        <label>{text('catalogLanguages')}
          <select value={filters.capability ?? ''} onChange={event => setFilters({ ...filters, capability: (event.target.value as ModelCapability | '') || undefined })}>
            <option value="">{text('catalogAny')}</option>
            <option value="multilingual">{text('catalogMultilingual')}</option>
            <option value="indic">{text('catalogIndic')}</option>
          </select>
        </label>
      </div>
      <p className="assistant-hint">{text('catalogHint')}</p>
      <p className="provider-catalog-count" role="status">{text('catalogResults', { count: models.length })}</p>
      {models.length > 0 && <ul className="provider-catalog-list">
        {models.map(model => {
          const access = model.access === 'free' ? 'catalogFree' : model.access === 'local' ? 'catalogLocal' : 'catalogByok'
          const context = model.contextTokens ? text('catalogTokens', { tokens: tokens.format(model.contextTokens) }) : text('catalogVariable')
          return <li key={model.provider + ':' + model.model}>
            <div className="provider-catalog-model">
              <strong>{model.label}</strong>
              <span>{[PROVIDERS[model.provider].label, text(access), context].join(' · ')}</span>
              {model.access === 'local' && <span>{text(model.hardware === 'compact' ? 'catalogCompact' : 'catalogStandard')}</span>}
              {model.capabilities.includes('indic') && <span>{text('catalogIndic')}</span>}
            </div>
            <div className="provider-catalog-actions">
              <a href={model.sourceUrl} target="_blank" rel="noopener noreferrer" title={text('catalogSource', { model: model.label })}
                aria-label={text('catalogSource', { model: model.label })} className="icon-button">
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
              <button type="button" className="secondary-button" disabled={disabled} aria-label={text('catalogUse', { model: model.label })}
                onClick={() => onSelect(model)}>{text('catalogUseShort')}</button>
            </div>
          </li>
        })}
      </ul>}
    </div>
  </details>
}
