import type messages from './i18n/messages/en.json'

export class VaultImportError extends Error {
  constructor(
    readonly code: keyof typeof messages['vault-import'],
    message: string = code,
    readonly values: Record<string, string | number> = {},
  ) { super(message) }
}
