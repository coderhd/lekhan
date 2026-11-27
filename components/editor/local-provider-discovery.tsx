'use client'

import { Check, Copy, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { useTranslations } from '@/lib/i18n/client'
import type { LocalProviderProbe } from '@/lib/ai/client'
import { localCorsCommand, localSetupPlatform, type LocalSetupPlatform } from '@/lib/ai/local-provider-setup'
import { PROVIDERS } from '@/lib/ai/provider-registry'

export default function LocalProviderDiscovery({ results, disabled, onSelect, native }: {
  results: readonly LocalProviderProbe[]
  disabled: boolean
  onSelect: (probe: LocalProviderProbe, model: string) => void
  native?: boolean
}) {
  const t = useTranslations('editor-ai')
  const origin = typeof location === 'undefined' ? '' : location.origin
  const [platform, setPlatform] = useState<LocalSetupPlatform>(() => localSetupPlatform(
    typeof navigator === 'undefined' ? '' : navigator.platform,
  ))
  const [copyResult, setCopyResult] = useState<{ command: string; copied: boolean }>()

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command)
      setCopyResult({ command, copied: true })
    } catch {
      setCopyResult({ command, copied: false })
    }
  }

  return (
    <section className="local-discovery" aria-label={t('localDiscovery')}>
      <VStack gap={3}>
        <Heading level={3}>{t('localDiscovery')}</Heading>
        <VStack gap={2}>
          {results.map(probe => {
            const provider = PROVIDERS[probe.provider]
            const command = localCorsCommand(probe.provider, origin, platform)
            const connected = probe.status === 'connected'

            return (
              <Card key={probe.provider} padding={3}>
                <VStack gap={2}>
                  <HStack justify="between" align="center" gap={2} wrap="wrap" className="local-discovery-heading">
                    <Text weight="semibold">{provider.label}</Text>
                    <HStack gap={1} align="center" data-status={probe.status}>
                      {connected && <Check size={13} aria-hidden="true" />}
                      <Text type="supporting">{t('probe_' + probe.status)}</Text>
                    </HStack>
                  </HStack>
                  <HStack gap={2} align="center" wrap="wrap" className="local-discovery-endpoint">
                    <Text type="code">{probe.baseUrl}</Text>
                    {connected && <Text type="supporting" color="secondary">{t('latency', { milliseconds: probe.latencyMs })}</Text>}
                  </HStack>
                  {connected && (probe.models.length ? (
                    <Selector
                      label={t('chooseLocalModel', { provider: provider.label })}
                      placeholder={t('useDiscoveredModel')}
                      isDisabled={disabled}
                      size="sm"
                      width="100%"
                      value=""
                      options={probe.models.map(model => ({ value: model, label: model }))}
                      onChange={value => { if (value) onSelect(probe, value) }}
                    />
                  ) : <Text size="sm" color="secondary">{t('probeEmptyModels')}</Text>)}
                  {probe.status === 'authorization_needed' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={<PlugZap size={15} aria-hidden="true" />}
                      isDisabled={disabled}
                      label={t('configureLocalAccess')}
                      onClick={() => onSelect(probe, '')}
                    />
                  )}
                  {probe.status === 'offline' && <Text size="sm" color="secondary">{t(native ? 'probeNativeOfflineHelp' : 'probeOfflineHelp')}</Text>}
                  {probe.status === 'unexpected_response' && <Text size="sm" color="secondary">{t('probeUnexpectedHelp')}</Text>}
                  {probe.status === 'cors_blocked' && (
                    <Collapsible defaultIsOpen={false} trigger={<Text size="sm" weight="semibold">{t('probeSetup')}</Text>} className="local-setup">
                      <VStack gap={2}>
                        {probe.provider === 'ollama' && command && (
                          <>
                            <Selector
                              label={t('setupPlatform')}
                              size="sm"
                              width="100%"
                              value={platform}
                              options={[
                                { value: 'mac', label: 'macOS' },
                                { value: 'windows', label: 'Windows' },
                                { value: 'linux', label: 'Linux' },
                              ]}
                              onChange={value => setPlatform(value as LocalSetupPlatform)}
                            />
                            <Text size="sm" color="secondary">{t('ollamaSetup_' + platform)}</Text>
                          </>
                        )}
                        {probe.provider === 'lmstudio' && <Text size="sm" color="secondary">{t('lmstudioSetup')}</Text>}
                        {probe.provider === 'llamacpp' && command && <Text size="sm" color="secondary">{t('llamacppSetup')}</Text>}
                        {probe.provider !== 'lmstudio' && !command && <Text size="sm" color="secondary">{t('probeUnknownOrigin')}</Text>}
                        {command && (
                          <VStack gap={1.5} align="start" className="local-setup-command">
                            <pre><code>{command}</code></pre>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              icon={<Copy size={15} aria-hidden="true" />}
                              label={t('copyLocalCommand')}
                              onClick={() => void copy(command)}
                            />
                            {copyResult?.command === command && (
                              <Text type="supporting" role="status">{t(copyResult.copied ? 'localCommandCopied' : 'localCommandCopyFailed')}</Text>
                            )}
                          </VStack>
                        )}
                        <Link href={provider.docsUrl} isExternalLink>
                          {t('providerSetupDocs', { provider: provider.label })}
                        </Link>
                      </VStack>
                    </Collapsible>
                  )}
                </VStack>
              </Card>
            )
          })}
        </VStack>
      </VStack>
    </section>
  )
}
