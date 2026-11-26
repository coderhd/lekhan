import { Check, Copy, PlugZap } from 'lucide-react'
import { useState } from 'react'
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

  return <section className="local-discovery" aria-label={t('localDiscovery')}>
    <h3>{t('localDiscovery')}</h3>
    <ul>
      {results.map(probe => {
        const provider = PROVIDERS[probe.provider]
        const command = localCorsCommand(probe.provider, origin, platform)
        const connected = probe.status === 'connected'

        return <li key={probe.provider}>
          <div className="local-discovery-heading">
            <strong>{provider.label}</strong>
            <span data-status={probe.status}>{connected && <Check size={13} aria-hidden="true" />}{t('probe_' + probe.status)}</span>
          </div>
          <div className="local-discovery-endpoint">
            <code>{probe.baseUrl}</code>
            {connected && <small>{t('latency', { milliseconds: probe.latencyMs })}</small>}
          </div>
          {connected && (probe.models.length
            ? <label>{t('chooseLocalModel', { provider: provider.label })}
              <select value="" disabled={disabled} onChange={event => {
                if (event.target.value) onSelect(probe, event.target.value)
              }}>
                <option value="">{t('useDiscoveredModel')}</option>
                {probe.models.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            : <p>{t('probeEmptyModels')}</p>)}
          {probe.status === 'authorization_needed' && <button className="secondary-button" type="button" disabled={disabled}
            onClick={() => onSelect(probe, '')}><PlugZap size={15} aria-hidden="true" /> {t('configureLocalAccess')}</button>}
          {probe.status === 'offline' && <p>{t(native ? 'probeNativeOfflineHelp' : 'probeOfflineHelp')}</p>}
          {probe.status === 'unexpected_response' && <p>{t('probeUnexpectedHelp')}</p>}
          {probe.status === 'cors_blocked' && <details className="local-setup">
            <summary>{t('probeSetup')}</summary>
            {probe.provider === 'ollama' && command && <>
              <label>{t('setupPlatform')}
                <select value={platform} onChange={event => setPlatform(event.target.value as LocalSetupPlatform)}>
                  <option value="mac">macOS</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </label>
              <p>{t('ollamaSetup_' + platform)}</p>
            </>}
            {probe.provider === 'lmstudio' && <p>{t('lmstudioSetup')}</p>}
            {probe.provider === 'llamacpp' && command && <p>{t('llamacppSetup')}</p>}
            {probe.provider !== 'lmstudio' && !command && <p>{t('probeUnknownOrigin')}</p>}
            {command && <div className="local-setup-command">
              <pre><code>{command}</code></pre>
              <button className="secondary-button" type="button" onClick={() => void copy(command)}>
                <Copy size={15} aria-hidden="true" /> {t('copyLocalCommand')}
              </button>
              {copyResult?.command === command && <small role="status">{t(copyResult.copied ? 'localCommandCopied' : 'localCommandCopyFailed')}</small>}
            </div>}
            <a className="assistant-provider-link" href={provider.docsUrl} target="_blank" rel="noopener noreferrer">{t('providerSetupDocs', { provider: provider.label })}</a>
          </details>}
        </li>
      })}
    </ul>
  </section>
}
