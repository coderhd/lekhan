/**
 * Maps a Supabase auth failure to copy a beta user can act on.
 *
 * Raw provider messages ("Invalid login credentials", "Failed to fetch",
 * "Email rate limit exceeded") are never rendered: they read like internals and
 * leak which half of the credential pair was wrong. Everything unmatched falls
 * back to a plain retry line.
 */
type AuthErrorLike = {
	message?: unknown
	status?: unknown
	code?: unknown
}

const INVALID_CREDENTIALS = 'Email or password is incorrect. Please try again.'
const EMAIL_NOT_CONFIRMED = 'Please confirm your email address, then sign in.'
const RATE_LIMITED = 'Too many attempts. Please wait a moment and try again.'
const UNREACHABLE = "We couldn't reach the server. Check your connection and try again."
const GENERIC = "We couldn't sign you in. Please try again."

export function friendlyAuthError(error: unknown): string {
	const candidate = (typeof error === 'object' && error !== null ? error : {}) as AuthErrorLike
	const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : ''
	const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
	const status = typeof candidate.status === 'number' ? candidate.status : undefined

	if (
		status === 429 ||
		code.includes('rate_limit') ||
		message.includes('rate limit') ||
		message.includes('too many')
	) {
		return RATE_LIMITED
	}

	if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
		return EMAIL_NOT_CONFIRMED
	}

	if (
		status === 0 ||
		error instanceof TypeError ||
		message.includes('failed to fetch') ||
		message.includes('fetch failed') ||
		message.includes('network')
	) {
		return UNREACHABLE
	}

	if (
		code === 'invalid_credentials' ||
		message.includes('invalid login credentials') ||
		message.includes('invalid credentials')
	) {
		return INVALID_CREDENTIALS
	}

	return GENERIC
}
