import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface ProfileMenuProps {
	user: {
		email: string
		full_name?: string
	}
	size?: 'sm' | 'md'
}

function getInitials(nameOrEmail: string) {
	if (!nameOrEmail) return '?'
	if (nameOrEmail.includes('@')) {
		return nameOrEmail.charAt(0).toUpperCase()
	}
	const parts = nameOrEmail.split(' ').filter(Boolean)
	if (parts.length > 1) {
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
	}
	return nameOrEmail.charAt(0).toUpperCase()
}

export default function ProfileMenu({ user, size = 'md' }: ProfileMenuProps) {
	const router = useRouter()
	const [isOpen, setIsOpen] = useState(false)
	const menuRef = useRef<HTMLDivElement>(null)

	const displayName = user.full_name || user.email.split('@')[0]
	const initials = getInitials(user.full_name || user.email)

	const handleSignOut = async () => {
		await supabase.auth.signOut()
		router.push('/login')
	}

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside)
		}
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [isOpen])

	const triggerClasses = size === 'sm' 
		? "w-8 h-8 rounded-full border border-primary/30 bg-primary/10 flex items-center justify-center text-primary font-bold shadow-sm hover:bg-primary/20 transition-colors"
		: "w-10 h-10 rounded-full border-2 border-primary-container/30 bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden cursor-pointer hover:border-primary-container premium-transition hover:scale-110 active:scale-95 select-none"

	return (
		<div className="relative flex items-center" ref={menuRef}>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className={triggerClasses}
			>
				{initials}
			</button>

			{isOpen && (
				<div className="absolute top-full right-0 mt-2 w-56 bg-surface-container-low border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden py-2 z-50 animate-dropdown-in origin-top-right">
					<div className="px-4 py-3 border-b border-black/5 dark:border-white/5 mb-1">
						<p className="font-semibold text-on-surface truncate">{displayName}</p>
						<p className="text-xs text-on-surface-variant truncate">{user.email}</p>
					</div>
					<button onClick={() => router.push('/settings')} className="w-full flex items-center gap-md px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-on-surface premium-transition text-left">
						<span className="material-symbols-outlined text-xl">settings</span>
						<span>Settings</span>
					</button>
					<button onClick={handleSignOut} className="w-full flex items-center gap-md px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-error premium-transition text-left">
						<span className="material-symbols-outlined text-xl">logout</span>
						<span>Sign Out</span>
					</button>
				</div>
			)}
		</div>
	)
}
