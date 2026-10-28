'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Check, Copy, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

export interface OwnershipCandidate {
	id: string
	email: string
	name?: string
}

interface TransferState {
	token: string
	acceptPath: string
	expiresAt: string
	outgoingSubscription: 'inactive' | 'live' | 'detaching' | 'none'
}

async function authHeaders(): Promise<Record<string, string>> {
	const { data } = await supabase.auth.getSession()
	const token = data.session?.access_token
	return {
		'Content-Type': 'application/json',
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	}
}

/**
 * T13 — workspace ownership transfer (US-8, PDEC-11).
 *
 * Two-step by design: the owner nominates a successor and the platform stops the
 * outgoing subscription (provider-verified); the successor must then accept from
 * their own signed-in account. No silent takeover, no content deletion, and the
 * workspace keeps its plan for the paid period.
 */
export default function OwnershipTransferCard({ candidates }: { candidates: OwnershipCandidate[] }) {
	const [successorId, setSuccessorId] = useState('')
	const [pending, setPending] = useState<'initiate' | 'accept' | null>(null)
	const [transfer, setTransfer] = useState<TransferState | null>(null)
	const [acceptToken, setAcceptToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	const options = useMemo(
		() => Array.from(new Map(candidates.map((c) => [c.id, c])).values()),
		[candidates],
	)

	useEffect(() => {
		if (typeof window === 'undefined') return
		const token = new URLSearchParams(window.location.search).get('transfer')
		if (token) setAcceptToken(token)
	}, [])

	const initiate = async () => {
		if (!successorId) {
			toast.error('Choose the person who should take ownership.')
			return
		}
		setPending('initiate')
		try {
			const res = await fetch('/api/billing/transfer', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'initiate', successorUserId: successorId }),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || 'Could not start the transfer.')
			setTransfer(data as TransferState)
			toast.success('Transfer prepared — the outgoing subscription is stopped at period end.')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not start the transfer.')
		} finally {
			setPending(null)
		}
	}

	const accept = async () => {
		if (!acceptToken) return
		setPending('accept')
		try {
			const res = await fetch('/api/billing/transfer', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ action: 'accept', token: acceptToken }),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok) throw new Error(data.error || 'Could not accept the transfer.')
			toast.success('You now own this workspace. Add a payment method to keep it after the paid period.')
			window.location.assign('/settings')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not accept the transfer.')
		} finally {
			setPending(null)
		}
	}

	const copyLink = async () => {
		if (!transfer) return
		const absolute = `${window.location.origin}${transfer.acceptPath}`
		try {
			await navigator.clipboard.writeText(absolute)
			setCopied(true)
			toast.success('Transfer link copied. Send it to the successor privately.')
		} catch {
			toast.error('Could not copy the link. Copy it from the field below.')
		}
	}

	if (acceptToken) {
		return (
			<section className="bg-primary/5 border border-primary/30 rounded-2xl p-6 md:p-8 space-y-4">
				<div className="flex items-center gap-2">
					<ArrowRightLeft className="w-5 h-5 text-primary" />
					<h2 className="text-lg font-display-md text-on-surface font-bold">Accept workspace ownership</h2>
				</div>
				<p className="text-xs text-on-surface-variant leading-relaxed">
					You were invited to take ownership of this workspace. Nothing is deleted: pages,
					collaborators and the current plan stay on the workspace for the paid period. You
					will need to add a payment method to renew it.
				</p>
				<div className="flex flex-wrap gap-3">
					<button
						type="button"
						onClick={() => void accept()}
						disabled={pending === 'accept'}
						className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60"
					>
						<Check className="w-4 h-4" />
						{pending === 'accept' ? 'Accepting…' : 'Accept ownership'}
					</button>
					<button
						type="button"
						onClick={() => setAcceptToken(null)}
						className="px-4 py-2.5 rounded-xl text-xs font-bold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
					>
						Not now
					</button>
				</div>
			</section>
		)
	}

	if (transfer) {
		const absolute = typeof window === 'undefined' ? transfer.acceptPath : `${window.location.origin}${transfer.acceptPath}`
		return (
			<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-4">
				<div className="flex items-center gap-2">
					<ShieldCheck className="w-5 h-5 text-primary" />
					<h2 className="text-lg font-display-md text-on-surface font-bold">Transfer prepared</h2>
				</div>
				<p className="text-xs text-on-surface-variant leading-relaxed">
					Send this private link to the successor. They must sign in with their own account
					and accept before the transfer completes — nothing changes until they do. The link
					expires on {new Date(transfer.expiresAt).toLocaleString()}.
				</p>
				{transfer.outgoingSubscription === 'detaching' && (
					<p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
						The outgoing subscription is stopped at period end (provider-verified). Access
						continues until then; the new owner adds a payment method to renew.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<input
						readOnly
						aria-label="Transfer accept link"
						value={absolute}
						className="flex-1 min-w-[240px] px-3 py-2 rounded-xl text-[11px] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-on-surface-variant"
					/>
					<button
						type="button"
						onClick={() => void copyLink()}
						className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-primary text-on-primary hover:bg-primary/90 transition-colors"
					>
						<Copy className="w-4 h-4" />
						{copied ? 'Copied' : 'Copy link'}
					</button>
				</div>
				<p className="text-[11px] text-on-surface-variant">
					Pages, collaborators and history are never deleted by a transfer.
				</p>
			</section>
		)
	}

	return (
		<section className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-4">
			<div className="flex items-center gap-2">
				<ArrowRightLeft className="w-5 h-5 text-primary" />
				<h2 className="text-lg font-display-md text-on-surface font-bold">Workspace ownership</h2>
			</div>
			<p className="text-xs text-on-surface-variant leading-relaxed">
				Hand the workspace and its billing obligation to a collaborator. The outgoing owner&apos;s
				subscription is stopped at period end and verified with the payment provider; the new
				owner must accept from their own account and add a payment method to renew.
			</p>

			{options.length === 0 ? (
				<p className="text-xs text-on-surface-variant italic">
					Invite someone to a page first — ownership can only move to an existing collaborator.
				</p>
			) : (
				<div className="flex flex-wrap items-end gap-3">
					<div className="flex-1 min-w-[220px]">
						<label htmlFor="transfer-successor" className="block text-[11px] font-semibold text-on-surface mb-1.5">
							New owner
						</label>
						<select
							id="transfer-successor"
							value={successorId}
							onChange={(event) => setSuccessorId(event.target.value)}
							className="w-full px-3 py-2 rounded-xl text-xs bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 text-on-surface"
						>
							<option value="">Choose a collaborator…</option>
							{options.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>
									{candidate.name || candidate.email} ({candidate.email})
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => void initiate()}
						disabled={pending === 'initiate' || !successorId}
						className="px-4 py-2.5 rounded-xl text-xs font-bold bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
					>
						{pending === 'initiate' ? 'Preparing…' : 'Prepare transfer'}
					</button>
				</div>
			)}

			<p className="text-[11px] text-on-surface-variant flex items-start gap-2">
				<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
				A workspace can have only one owner. The successor must not already own a Lekhan workspace.
			</p>
		</section>
	)
}
