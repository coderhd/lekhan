'use client'

import { ArrowUpRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Grid } from '@astryxdesign/core/Grid'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
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

  return (
    <Collapsible defaultIsOpen={false} trigger={<Text weight="semibold">{text('catalogTitle')}</Text>} className="provider-catalog">
      <VStack gap={3} className="provider-catalog-content">
        <TextInput
          type="search"
          label={text('catalogSearch')}
          isLabelHidden
          placeholder={text('catalogSearch')}
          startIcon={<Search size={16} aria-hidden="true" />}
          width="100%"
          value={filters.query ?? ''}
          onChange={value => setFilters({ ...filters, query: value })}
        />
        <Grid columns={{ minWidth: 160, max: 3 }} gap={2} className="provider-catalog-filters">
          <Selector
            label={text('catalogCost')}
            size="sm"
            width="100%"
            value={filters.access ?? ''}
            options={[
              { value: '', label: text('catalogAny') },
              { value: 'free', label: text('catalogFree') },
              { value: 'byok', label: text('catalogByok') },
              { value: 'local', label: text('catalogLocal') },
            ]}
            onChange={value => setFilters({ ...filters, access: (value as ModelAccess | '') || undefined })}
          />
          <Selector
            label={text('catalogRunsOn')}
            size="sm"
            width="100%"
            value={filters.locality ?? ''}
            options={[
              { value: '', label: text('catalogAny') },
              { value: 'device', label: text('catalogDevice') },
              { value: 'cloud', label: text('catalogCloud') },
            ]}
            onChange={value => {
              const locality = value as ModelFilters['locality'] | ''
              setFilters({ ...filters, locality: locality || undefined, hardware: locality === 'cloud' ? undefined : filters.hardware })
            }}
          />
          <Selector
            label={text('catalogHardware')}
            size="sm"
            width="100%"
            isDisabled={filters.locality === 'cloud'}
            value={filters.hardware ?? ''}
            options={[
              { value: '', label: text('catalogAny') },
              { value: 'compact', label: text('catalogCompact') },
              { value: 'standard', label: text('catalogStandard') },
            ]}
            onChange={value => setFilters({ ...filters, hardware: (value as ModelHardware | '') || undefined })}
          />
          <Selector
            label={text('catalogContext')}
            size="sm"
            width="100%"
            value={String(filters.minContextTokens ?? 0)}
            options={[
              { value: '0', label: text('catalogAny') },
              ...[32_000, 128_000, 1_000_000].map(count => ({
                value: String(count),
                label: text('catalogMinimum', { tokens: tokens.format(count) }),
              })),
            ]}
            onChange={value => setFilters({ ...filters, minContextTokens: Number(value) })}
          />
          <Selector
            label={text('catalogLanguages')}
            size="sm"
            width="100%"
            value={filters.capability ?? ''}
            options={[
              { value: '', label: text('catalogAny') },
              { value: 'multilingual', label: text('catalogMultilingual') },
              { value: 'indic', label: text('catalogIndic') },
            ]}
            onChange={value => setFilters({ ...filters, capability: (value as ModelCapability | '') || undefined })}
          />
        </Grid>
        <Text type="supporting" color="secondary">{text('catalogHint')}</Text>
        <Text type="supporting" role="status">{text('catalogResults', { count: models.length })}</Text>
        {models.length > 0 && (
          <VStack gap={1} className="provider-catalog-list">
            {models.map(model => {
              const access = model.access === 'free' ? 'catalogFree' : model.access === 'local' ? 'catalogLocal' : 'catalogByok'
              const context = model.contextTokens ? text('catalogTokens', { tokens: tokens.format(model.contextTokens) }) : text('catalogVariable')
              const details = [
                PROVIDERS[model.provider].label,
                text(access),
                context,
                ...(model.access === 'local' ? [text(model.hardware === 'compact' ? 'catalogCompact' : 'catalogStandard')] : []),
                ...(model.capabilities.includes('indic') ? [text('catalogIndic')] : []),
              ].join(' · ')
              return (
                <Item
                  key={model.provider + ':' + model.model}
                  density="compact"
                  label={model.label}
                  description={details}
                  endContent={
                    <HStack gap={1} align="center">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        href={model.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        label={text('catalogSource', { model: model.label })}
                        tooltip={text('catalogSource', { model: model.label })}
                        icon={<ArrowUpRight size={15} aria-hidden="true" />}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        isDisabled={disabled}
                        label={text('catalogUseShort')}
                        aria-label={text('catalogUse', { model: model.label })}
                        onClick={() => onSelect(model)}
                      />
                    </HStack>
                  }
                />
              )
            })}
          </VStack>
        )}
      </VStack>
    </Collapsible>
  )
}
