'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { saveEncryptedApiKey, getDecryptedApiKey, clearApiKey } from '@/lib/crypto'
import styles from './settings/ai-controls.module.css'
import { track } from '@/lib/analytics'

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

			await saveEncryptedApiKey(apiKey.trim(), { onlyIfLegacyPlaintext: isConnected })
			if (isConnected) {
				toast.success('Saved Sarvam key verified.')
				return
			}
			setIsConnected(true)
			track('ai_provider_connected', { kind: 'byok' })
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
		<section className={styles.section}>
			<div className={styles.sectionHeader}>
				<h3>Sarvam AI Key (BYOK)</h3>
				{isConnected && <span className={styles.status}><CheckCircle2 /> Connected</span>}
			</div>
			<form onSubmit={handleConnectKey} className={styles.field}>
				<label htmlFor="sarvam-byok-key">Sarvam AI key</label>
				<div className={styles.controlRow}>
					<div className={styles.secret}>
						<input id="sarvam-byok-key" type={showKey ? 'text' : 'password'} autoComplete="off"
							readOnly={isConnecting} aria-describedby="sarvam-byok-help" value={apiKey} placeholder="sk_sarvam..."
							onChange={event => {
								setApiKey(event.target.value)
								setIsConnected(false)
							}} />
						<button type="button" className={styles.eye} aria-label={showKey ? 'Hide Sarvam key' : 'Show Sarvam key'} onClick={() => setShowKey(!showKey)}>
							{showKey ? <EyeOff /> : <Eye />}
						</button>
					</div>
					<div className={styles.actions}>
						<button type="submit" className={isConnected ? styles.secondary : styles.primary} disabled={!isValidKey || isConnecting}>
							{isConnecting ? 'Verifying…' : isConnected ? 'Test saved key' : 'Connect'}
						</button>
						{isConnected && <button type="button" className={styles.secondary} disabled={isConnecting} onClick={handleDisconnectKey}>Disconnect</button>}
					</div>
				</div>
				<p className={styles.hint} id="sarvam-byok-help">Keys start with <code>sk_</code> and are AES-256-GCM encrypted on this device.</p>
			</form>
		</section>
	)
}
