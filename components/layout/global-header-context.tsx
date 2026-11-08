'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type GlobalHeaderSlotName = 'main' | 'right'

type SlotEntry = { id: symbol; content: React.ReactNode }
type GlobalHeaderSlots = Partial<Record<GlobalHeaderSlotName, SlotEntry>>

type GlobalHeaderSlotsContextValue = {
	slots: GlobalHeaderSlots
	workbenchChrome: boolean
	registerWorkbenchChrome: () => () => void
	registerSlot: (slot: GlobalHeaderSlotName, content: React.ReactNode) => () => void
}

const GlobalHeaderSlotsContext = createContext<GlobalHeaderSlotsContextValue | null>(null)

export function useGlobalHeaderSlots() {
	const context = useContext(GlobalHeaderSlotsContext)
	if (!context) {
		throw new Error('useGlobalHeaderSlots must be used within a GlobalHeaderProvider')
	}
	return context
}

export function GlobalHeaderProvider({ children }: { children: React.ReactNode }) {
	const [chromeOwners, setChromeOwners] = useState<Set<symbol>>(() => new Set())
	const registerWorkbenchChrome = useCallback(() => {
		const id = Symbol()
		setChromeOwners(current => new Set(current).add(id))
		return () => setChromeOwners(current => {
			const next = new Set(current)
			next.delete(id)
			return next
		})
	}, [])
	const [slots, setSlots] = useState<GlobalHeaderSlots>({})

	const registerSlot = useCallback((slot: GlobalHeaderSlotName, content: React.ReactNode) => {
		const id = Symbol(slot)
		setSlots((current) => ({ ...current, [slot]: { id, content } }))
		return () => setSlots((current) => current[slot]?.id === id
			? { ...current, [slot]: undefined }
			: current)
	}, [])

	return (
		<GlobalHeaderSlotsContext.Provider value={{ slots, registerSlot, workbenchChrome: chromeOwners.size > 0, registerWorkbenchChrome }}>
			{children}
		</GlobalHeaderSlotsContext.Provider>
	)
}

export function GlobalHeaderSlot({
	slot,
	children,
}: {
	slot: GlobalHeaderSlotName
	children: React.ReactNode
}) {
	const { registerSlot } = useGlobalHeaderSlots()

	useEffect(() => registerSlot(slot, children), [children, registerSlot, slot])

	return null
}
