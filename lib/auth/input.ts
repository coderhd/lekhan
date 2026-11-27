export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'
export type AuthResult =
  | { issue: 'unavailable' | 'invalid' | 'loginError' | 'signupError' | 'resetError' }
  | { outcome: 'confirmEmail' | 'resetEmail' }
  | null

export function invitationPath(token: string | undefined | null) {
  return token && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(token) ? '/invite/' + token : null
}

export function workspaceTransferPath(token: string | undefined | null) {
  return token && /^[\w-]{43}$/.test(token) ? '/billing/transfer/' + token : null
}

export function billingNextPath(value: string | undefined | null) {
  if (!value || value.length > 256) return null
  if (value === '/billing') return '/billing'
  if (!value.startsWith('/billing?')) return null
  return /^\/billing\?[a-zA-Z0-9_=&%-]+$/.test(value) ? value : null
}

export function referralCode(input: unknown) {
  const value = typeof input === 'string' ? input.trim() : ''
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined
}

export function readCredentials(form: FormData, mode: AuthMode) {
  const email = form.get('email')
  const password = form.get('password')
  const address = typeof email === 'string' ? email.trim() : ''
  const secret = typeof password === 'string' ? password : ''
  if (mode !== 'reset' && (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) return null
  if (mode !== 'forgot' && (!secret || secret.length > 256)) return null
  if ((mode === 'reset' || mode === 'signup') && secret.length < 8) return null
  if (mode === 'reset' && form.get('confirmPassword') !== secret) return null
  return { email: address, password: secret }
}

export function readConfirmation(params: URLSearchParams) {
  const code = params.get('code')
  const hash = params.get('token_hash')
  const type = params.get('type')
  if (hash && hash.length <= 512 && (type === 'email' || type === 'signup' || type === 'recovery')) {
    return { method: 'token' as const, hash, type, recovery: type === 'recovery' }
  }
  if (code && code.length <= 256) return { method: 'code' as const, code, recovery: params.get('flow') === 'recovery' }
  return null
}
