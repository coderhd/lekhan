'use client'

import { useState, useEffect } from 'react'
import { Key, Check, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

export default function BYOKSettings() {
	const [apiKey, setApiKey] = useState('')
	const [showKey, setShowKey] = useState(false)

	useEffect(() => {
		const savedKey = localStorage.getItem('lekhan_custom_api_key') || ''
		setApiKey(savedKey)
	}, [])

	const handleSaveKey = (e: React.FormEvent) => {
		e.preventDefault()
		localStorage.setItem('lekhan_custom_api_key', apiKey.trim())
		toast.success('Custom API Key saved successfully!')
	}

	const handleClearKey = () => {
		localStorage.removeItem('lekhan_custom_api_key')
		setApiKey('')
		toast.info('Custom API Key removed.')
	}

	return (
		<div className="bg-white/5 dark:bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-md shadow-sm space-y-4">
			<div className="flex items-center gap-3">
				<div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
					<Key className="w-5 h-5" />
				</div>
				<div>
					<h3 className="text-lg font-display-md text-on-surface">Bring Your Own API Key (BYOK)</h3>
					<p className="text-xs text-on-surface-variant">Use your own Gemini / Sarvam API key for unlimited AI operations after exhausting plan credits.</p>
				</div>
			</div>

			<form onSubmit={handleSaveKey} className="space-y-4 max-w-md pt-2">
				<div>
					<label className="block text-xs font-label-sm text-on-surface-variant uppercase tracking-wider mb-2">Gemini / AI API Key</label>
					<div className="relative">
						<input
							type={showKey ? 'text' : 'password'}
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="AIzaSy..."
							className="w-full bg-black/5 dark:bg-surface-dim border border-black/10 dark:border-outline/30 rounded-lg px-4 py-2.5 pr-10 text-xs text-on-surface focus:outline-none focus:border-primary-container"
						/>
						<button
							type="button"
							onClick={() => setShowKey(!showKey)}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/70 hover:text-on-surface"
						>
							{showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
						</button>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<button
						type="submit"
						className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-medium hover:bg-primary/90 transition-all flex items-center gap-1.5"
					>
						<Check className="w-3.5 h-3.5" /> Save API Key
					</button>
					{apiKey && (
						<button
							type="button"
							onClick={handleClearKey}
							className="px-3 py-2 rounded-lg border border-error/30 text-error text-xs hover:bg-error/10 transition-all"
						>
							Remove Key
						</button>
					)}
				</div>
			</form>
		</div>
	)
}
