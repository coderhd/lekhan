import type { LocalProviderId } from './provider-registry'

export type LocalSetupPlatform = 'mac' | 'windows' | 'linux'

export function localSetupPlatform(platform: string): LocalSetupPlatform {
  if (/win/i.test(platform)) return 'windows'
  if (/mac|iphone|ipad/i.test(platform)) return 'mac'
  return 'linux'
}

export function localCorsCommand(provider: LocalProviderId, origin: string, platform: LocalSetupPlatform) {
  if (!/^(?:https?|tauri):\/\/(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d{1,5})?$/i.test(origin)) return undefined
  if (provider === 'llamacpp') return `--cors-origins "${origin}"`
  if (provider !== 'ollama') return undefined
  if (platform === 'mac') return `launchctl setenv OLLAMA_ORIGINS '${origin}'`
  if (platform === 'windows') return `$env:OLLAMA_ORIGINS = '${origin}'\nollama serve`
  return `OLLAMA_ORIGINS='${origin}' ollama serve`
}
