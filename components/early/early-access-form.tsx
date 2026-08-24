'use client'

import { useState, type FormEvent } from 'react'
import { track } from '@/lib/analytics'

interface JoinResponse {
	position: number
	alreadyJoined: boolean
	foundingFull: boolean
	cap: number
}

type FormState =
	| { kind: 'idle' }
	| { kind: 'submitting' }
	| { kind: 'success'; position: number; alreadyJoined: boolean; foundingFull: boolean }
	| { kind: 'error'; message: string }

/**
 * Claim form for the founding edition (#85). Progressive enhancement: works
 * as a plain POST when JS is off (the route redirects back with ?joined=N).
 */
export function EarlyAccessForm ({ defaultRef }: { defaultRef?: string }) {
	const [state, setState] = useState<FormState>({ kind: 'idle' })

	async function onSubmit (event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		setState({ kind: 'submitting' })

		try {
			const params = new URLSearchParams()
			if (defaultRef) params.set('ref', defaultRef)
			const response = await fetch(`/api/waitlist?${params}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					email: String(data.get('email') ?? ''),
					use_case: String(data.get('use_case') ?? ''),
				}),
			})
			const body = (await response.json()) as JoinResponse & { error?: string }
			if (!response.ok) {
				setState({ kind: 'error', message: body.error ?? 'Something went wrong. Please try again.' })
				return
			}
			track('early_access_signup', {
				already_joined: body.alreadyJoined,
				wave2: body.foundingFull,
				position_bucket:
					body.position <= 50 ? '1-50' : body.position <= 150 ? '51-150' : body.position <= 500 ? '151-500' : 'wave2',
			})
			setState({
				kind: 'success',
				position: body.position,
				alreadyJoined: body.alreadyJoined,
				foundingFull: body.foundingFull,
			})
		} catch {
			setState({ kind: 'error', message: 'Network hiccup — check your connection and try again.' })
		}
	}

	if (state.kind === 'success') {
		return (
			<div className="ek-plate" role="status">
				{state.foundingFull ? (
					<>
						<p className="ek-plate-figure tnum">№ {state.position}</p>
						<p className="ek-plate-note">
							The founding edition of 500 is fully claimed — you&apos;re on the wave-two list.
							We&apos;ll email your invite the moment a spot opens.
						</p>
					</>
				) : (
					<>
						<p className="ek-plate-kicker">Your founding spot</p>
						<p className="ek-plate-figure tnum">
							№ {state.position} <span className="ek-plate-of">of 500</span>
						</p>
						<p className="ek-plate-note">
							{state.alreadyJoined
								? 'You were already on the list — this is your spot.'
								: 'Spot reserved. Check your inbox for the confirmation email — your invite follows once you confirm.'}
						</p>
					</>
				)}
			</div>
		)
	}

	return (
		<form method="POST" action="/api/waitlist" onSubmit={onSubmit} className="ek-form" noValidate>
			{defaultRef != null && <input type="hidden" name="ref" value={defaultRef} />}
			<div className="ek-form-row">
				<label className="ek-label" htmlFor="ek-email">
					Email
				</label>
				<input
					id="ek-email"
					className={`ek-input${state.kind === 'error' ? ' ek-input-invalid' : ''}`}
					type="email"
					name="email"
					autoComplete="email"
					placeholder="you@example.com"
					required
					disabled={state.kind === 'submitting'}
					aria-describedby={state.kind === 'error' ? 'ek-email-error' : undefined}
				/>
				<button
					className="ek-button"
					type="submit"
					disabled={state.kind === 'submitting'}
					data-state={state.kind === 'submitting' ? 'loading' : 'default'}
				>
					{state.kind === 'submitting' ? 'Reserving…' : 'Claim your spot'}
				</button>
			</div>
			<label className="ek-label" htmlFor="ek-use-case">
				What would you use Lekhan for? <span className="ek-optional">(optional)</span>
			</label>
			<textarea
				id="ek-use-case"
				className="ek-textarea"
				name="use_case"
				rows={2}
				maxLength={500}
				placeholder="A team wiki that lives in my own files…"
				disabled={state.kind === 'submitting'}
			/>
			{state.kind === 'error' && (
				<p id="ek-email-error" className="ek-error" role="alert">
					{state.message}
				</p>
			)}
			<p className="ek-fineprint">
				Double opt-in — you&apos;ll get one confirmation email first. No spam, ever.
			</p>
		</form>
	)
}
