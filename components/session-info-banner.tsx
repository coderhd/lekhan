'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Shield, X } from 'lucide-react'

export function SessionInfoBanner() {
	const [visible, setVisible] = useState(false)
	const [userLoggedIn, setUserLoggedIn] = useState(false)

	useEffect(() => {
		// Check if user is logged in
		const checkUser = async () => {
			const { data: { session } } = await supabase.auth.getSession()
			setUserLoggedIn(!!session)
		}
		
		checkUser()

		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			setUserLoggedIn(!!session)
		})

		// Check if acknowledgement cookie/localStorage exists
		if (typeof window !== 'undefined') {
			const acknowledged = localStorage.getItem('lekhan_storage_acknowledged')
			if (!acknowledged) {
				setVisible(true)
			}
		}

		return () => {
			subscription.unsubscribe()
		}
	}, [])

	const handleAcknowledge = () => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('lekhan_storage_acknowledged', 'true')
			setVisible(false)
		}
	}

	if (!visible || !userLoggedIn) return null

	return (
		<div className="fixed bottom-6 right-6 z-[9990] max-w-md w-full animate-in slide-in-from-bottom-5 duration-500">
			<div className="glass rounded-xl p-5 border border-primary-container/20 shadow-2xl bg-surface-container-low/95 backdrop-blur-lg flex gap-4 relative">
				<button 
					onClick={handleAcknowledge}
					className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
					aria-label="Close message"
				>
					<X className="w-4 h-4" />
				</button>

				<div className="w-10 h-10 rounded-lg bg-primary-container/10 border border-primary-container/20 flex items-center justify-center text-primary-container shrink-0">
					<Shield className="w-5 h-5" />
				</div>

				<div className="flex-1 pr-4">
					<h3 className="font-semibold text-sm text-foreground mb-1">
						Session Security Notice
					</h3>
					<p className="text-xs text-muted-foreground leading-relaxed">
						Lekhan stores a local session activity timestamp on your device to protect your workspace. This enables idle session locking and automatic time-box protection.
					</p>
					<button
						onClick={handleAcknowledge}
						className="mt-3.5 bg-primary-container text-on-primary-fixed text-xs font-bold px-4 py-2 rounded-md hover:bg-primary transition-all active:scale-[0.98]"
					>
						I Understand
					</button>
				</div>
			</div>
		</div>
	)
}
