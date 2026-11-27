'use client'

import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Item } from '@astryxdesign/core/Item'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
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

  return (
    <Collapsible trigger={<Text weight="semibold" size="sm">{t('fallbackSettings')}</Text>} defaultIsOpen={chain.length > 0} className="fallback-settings">
      <VStack gap={2}>
        <Text type="supporting" color="secondary">{t('fallbackSettingsHint')}</Text>
        {chain.length > 0 && (
          <VStack gap={1} className="fallback-list">
            {chain.map((id, index) => {
              const label = routes.find(route => route.id === id)?.label ?? t('fallbackUnavailable')
              return (
                <Item
                  key={id}
                  density="compact"
                  label={label}
                  endContent={
                    <HStack gap={0.5} align="center">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={t('moveFallbackUp', { model: label })}
                        isDisabled={disabled || index === 0}
                        icon={<ArrowUp size={15} aria-hidden="true" />}
                        onClick={() => move(index, -1)}
                      />
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={t('moveFallbackDown', { model: label })}
                        isDisabled={disabled || index === chain.length - 1}
                        icon={<ArrowDown size={15} aria-hidden="true" />}
                        onClick={() => move(index, 1)}
                      />
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={t('removeFallback', { model: label })}
                        isDisabled={disabled}
                        icon={<X size={15} aria-hidden="true" />}
                        onClick={() => onChange(chain.filter(candidate => candidate !== id))}
                      />
                    </HStack>
                  }
                />
              )
            })}
          </VStack>
        )}
        {available.length > 0 && chain.length < MAX_FALLBACK_MODELS && (
          <Selector
            label={t('addFallback')}
            placeholder={t('chooseFallback')}
            isDisabled={disabled}
            size="sm"
            width="100%"
            value=""
            options={available.map(route => ({ value: route.id, label: route.label }))}
            onChange={value => {
              if (value) onChange([...chain, value])
            }}
          />
        )}
      </VStack>
    </Collapsible>
  )
}
