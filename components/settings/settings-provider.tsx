'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useSessionReauth } from '@/components/session-reauth-provider'
import styles from './settings.module.css'

const SettingsContent = dynamic(() => import('./settings-content'), {
	loading: () => <p className={styles.message} role="status">Loading settings…</p>,
})

export type SettingsTab = 'profile' | 'ai' | 'billing' | 'collaborators'
type OpenSettings = (tab?: SettingsTab, trigger?: HTMLElement | null) => void
const SettingsContext = createContext<OpenSettings>(() => {})
export const useOpenSettings = () => useContext(SettingsContext)

export function SettingsDialog({ tab, onClose, returnFocus }: {
	tab: SettingsTab
	onClose: () => void
	returnFocus?: HTMLElement | null
}) {
	const { isLocked } = useSessionReauth()
	const closing = useRef(false)
	if (isLocked) return null
	return (
		<Dialog.Root open onOpenChange={open => {
				if (!open) {
					closing.current = true
					onClose()
				}
			}}>
			<Dialog.Portal>
				<Dialog.Overlay className={styles.scrim} />
				<Dialog.Content data-modal="settings" className={styles.dialog} aria-describedby={undefined}
					onCloseAutoFocus={event => {
						event.preventDefault()
						if (closing.current && returnFocus?.isConnected) returnFocus.focus()
					}}>
					<header className={styles.header}>
						<Dialog.Title>Settings</Dialog.Title>
						<Dialog.Close className={styles.close} aria-label="Close settings"><X aria-hidden /></Dialog.Close>
					</header>
					<SettingsContent initialTab={tab} />
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}

export function SettingsProvider({ children }: { children: ReactNode }) {
	const [request, setRequest] = useState<{ tab: SettingsTab; trigger: HTMLElement | null } | null>(null)
	const pathname = usePathname()
	useEffect(() => { setRequest(null) }, [pathname])
	const open: OpenSettings = (section = 'profile', element) => {
		const trigger = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
		setRequest({ tab: section, trigger })
	}
	return <SettingsContext.Provider value={open}>
		{children}
		{request && <SettingsDialog tab={request.tab} onClose={() => setRequest(null)} returnFocus={request.trigger} />}
	</SettingsContext.Provider>
}
