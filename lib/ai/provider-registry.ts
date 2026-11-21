type Protocol = 'openai' | 'anthropic' | 'gemini' | 'ollama'
interface ProviderDefinition {
  label: string
  protocol: Protocol
  requiresKey: boolean
  baseUrl?: string
  docsUrl: string
  signupUrl?: string
  local?: boolean
}

export const PROVIDERS = {
  openai: { label: 'OpenAI', protocol: 'openai', requiresKey: true, baseUrl: 'https://api.openai.com/v1', docsUrl: 'https://platform.openai.com/docs', signupUrl: 'https://platform.openai.com/api-keys' },
  openrouter: { label: 'OpenRouter', protocol: 'openai', requiresKey: true, baseUrl: 'https://openrouter.ai/api/v1', docsUrl: 'https://openrouter.ai/docs', signupUrl: 'https://openrouter.ai/settings/keys' },
  anthropic: { label: 'Anthropic', protocol: 'anthropic', requiresKey: true, baseUrl: 'https://api.anthropic.com/v1', docsUrl: 'https://platform.claude.com/docs', signupUrl: 'https://platform.claude.com/settings/keys' },
  gemini: { label: 'Google Gemini', protocol: 'gemini', requiresKey: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', docsUrl: 'https://ai.google.dev/gemini-api/docs', signupUrl: 'https://aistudio.google.com/app/apikey' },
  groq: { label: 'Groq', protocol: 'openai', requiresKey: true, baseUrl: 'https://api.groq.com/openai/v1', docsUrl: 'https://console.groq.com/docs', signupUrl: 'https://console.groq.com/keys' },
  zai: { label: 'Z.AI', protocol: 'openai', requiresKey: true, baseUrl: 'https://api.z.ai/api/paas/v4', docsUrl: 'https://docs.z.ai', signupUrl: 'https://z.ai/manage-apikey/apikey-list' },
  sarvam: { label: 'Sarvam', protocol: 'openai', requiresKey: true, baseUrl: 'https://api.sarvam.ai/v2', docsUrl: 'https://docs.sarvam.ai/api-reference/chat/chat-completions-v2', signupUrl: 'https://dashboard.sarvam.ai' },
  ollama: { label: 'Ollama', protocol: 'ollama', requiresKey: false, local: true, baseUrl: 'http://localhost:11434', docsUrl: 'https://docs.ollama.com/faq' },
  lmstudio: { label: 'LM Studio', protocol: 'openai', requiresKey: false, local: true, baseUrl: 'http://localhost:1234/v1', docsUrl: 'https://lmstudio.ai/docs/developer' },
  llamacpp: { label: 'llama.cpp', protocol: 'openai', requiresKey: false, local: true, baseUrl: 'http://localhost:8080/v1', docsUrl: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server' },
  custom: { label: 'OpenAI-compatible endpoint', protocol: 'openai', requiresKey: false, docsUrl: 'https://platform.openai.com/docs/api-reference/chat' },
} satisfies Record<string, ProviderDefinition>

export type ProviderId = keyof typeof PROVIDERS
export interface ProviderConfig {
  id: string
  provider: ProviderId
  model: string
  label?: string
  baseUrl?: string
  apiKey?: string
}

export const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'llamacpp'] as const
export const FREE_PRESETS = [
  { provider: 'openrouter', model: 'openrouter/free', label: 'OpenRouter Free Models Router', sourceUrl: 'https://openrouter.ai/openrouter/free' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite', label: 'Gemini Flash-Lite', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing' },
  { provider: 'groq', model: 'openai/gpt-oss-20b', label: 'GPT OSS 20B', sourceUrl: 'https://console.groq.com/docs/models' },
  { provider: 'zai', model: 'glm-4.7-flash', label: 'GLM 4.7 Flash', sourceUrl: 'https://docs.z.ai/guides/llm/glm-4.7' },
].map(preset => ({
  ...preset, provider: preset.provider as ProviderId, verifiedDate: '2026-11-21',
  description: 'Availability and quota depend on your provider account.', tosFlag: true,
}))

export function providerDefinition(provider: ProviderId): ProviderDefinition {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unknown AI provider.')
  return PROVIDERS[provider]
}

export function endpointFor(config: ProviderConfig) {
  const definition = providerDefinition(config.provider)
  if (config.baseUrl?.trim() && !definition.local && config.provider !== 'custom') {
    throw new Error('Use the provider’s default endpoint or add a custom connection.')
  }
  let url: URL
  try {
    url = new URL(config.baseUrl?.trim() || definition.baseUrl || '')
  } catch {
    throw new Error('Enter a valid provider endpoint URL.')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new Error('Set a clean HTTPS endpoint or a localhost HTTP endpoint.')
  }
  if (definition.local && !local) throw new Error('Local model connections must use a localhost endpoint.')
  return url.toString().replace(/\/+$/, '')
}

export function localConnectionHelp(provider: ProviderId, origin = typeof location === 'undefined' ? 'http://localhost:3000' : location.origin) {
  if (provider === 'ollama') return 'Start Ollama and allow this app origin in OLLAMA_ORIGINS (' + origin + ').'
  if (provider === 'lmstudio') return 'Start the LM Studio local server and enable CORS for this app.'
  return 'Start the llama.cpp server and allow this app in your browser’s local network settings.'
}
