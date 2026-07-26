'use client'

import { useState, useEffect } from 'react'
import { Key, ShieldCheck, Eye, EyeOff, Loader2, CheckCircle2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { saveEncryptedApiKey, getDecryptedApiKey, clearApiKey } from '@/lib/crypto'

export default function BYOKSettings() {
	const [apiKey, setApiKey] = useState('')
	const [showKey, setShowKey] = useState(false)
	const [isConnecting, setIsConnecting] = useState(false)
	const [isConnected, setIsConnected] = useState(false)

	useEffect(() => {
		const loadSavedKey = async () => {
			const savedKey = await getDecryptedApiKey()
			if (savedKey) {
				setApiKey(savedKey)
				setIsConnected(true)
			}
		}
		loadSavedKey()
	}, [])

	const isValidKey = apiKey.trim().startsWith('sk_') && apiKey.trim().length >= 10

	const handleConnectKey = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!isValidKey) {
			toast.error('Invalid key format. Sarvam API Key must start with sk_')
			return
		}

		setIsConnecting(true)
		try {
			const res = await fetch('/api/ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'validate-key', key: apiKey.trim() }),
			})

			if (!res.ok) {
				const err = await res.json()
				throw new Error(err.error || 'Key verification failed')
			}

			await saveEncryptedApiKey(apiKey.trim())
			setIsConnected(true)
			toast.success('Sarvam API Key connected & AES-256 encrypted successfully!')
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			toast.error(`Connection failed: ${msg}`)
		} finally {
			setIsConnecting(false)
		}
	}

	const handleDisconnectKey = () => {
		clearApiKey()
		setApiKey('')
		setIsConnected(false)
		toast.info('Sarvam API Key disconnected & removed from local storage.')
	}

	return (
		<div className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-5">
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
						<Key className="w-5 h-5" />
					</div>
					<div>
						<h3 className="text-lg font-display-md text-on-surface">Sarvam AI Key (BYOK)</h3>
						<p className="text-xs text-on-surface-variant">Use your custom key for unlimited AI features.</p>
					</div>
				</div>
				<div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold shrink-0">
					<Lock className="w-3 h-3" />
					<span>AES-256-GCM Encrypted</span>
				</div>
			</div>

			<form onSubmit={handleConnectKey} className="space-y-3 pt-1">
				<div>
					<div className="flex justify-between items-center mb-1.5">
						<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider">Sarvam AI Key</label>
						{isConnected && (
							<span className="text-[10px] text-primary font-medium flex items-center gap-1">
								<CheckCircle2 className="w-3 h-3 text-primary" /> Connected & Secured
							</span>
						)}
					</div>
					<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
						<div className="relative flex-1">
							<input
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								onChange={(e) => {
									setApiKey(e.target.value)
									setIsConnected(false)
								}}
								placeholder="sk_sarvam..."
								className="w-full bg-black/5 dark:bg-surface-dim border border-black/10 dark:border-outline/30 rounded-xl px-4 py-2.5 pr-10 text-xs text-on-surface focus:outline-none focus:border-primary-container"
							/>
							<button
								type="button"
								onClick={() => setShowKey(!showKey)}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 hover:text-on-surface"
							>
								{showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
							</button>
						</div>
						<div className="flex items-center gap-2 shrink-0">
							<button
								type="submit"
								disabled={!isValidKey || isConnecting}
								className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-medium hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none shadow-sm min-w-[110px]"
							>
								{isConnecting ? (
									<>
										<Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting...
									</>
								) : (
									<>
										<ShieldCheck className="w-4 h-4" /> Connect
									</>
								)}
							</button>

							{isConnected && (
								<button
									type="button"
									onClick={handleDisconnectKey}
									className="px-3.5 py-2.5 rounded-xl border border-error/30 text-error text-xs hover:bg-error/10 transition-all"
								>
									Disconnect
								</button>
							)}
						</div>
					</div>
					<p className="text-[10px] text-on-surface-variant/70 mt-1.5">Key must start with <code className="text-primary font-bold">sk_</code></p>
				</div>
			</form>

			<div className="p-3.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-[11px] text-on-surface-variant flex items-center gap-2.5">
				<Lock className="w-4 h-4 text-primary shrink-0" />
				<span>Zero-Knowledge Storage: Your key is encrypted locally via AES-256-GCM and never sent to our servers.</span>
			</div>
		</div>
	)
}
