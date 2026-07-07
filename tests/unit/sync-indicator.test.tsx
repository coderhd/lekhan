import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SyncIndicator from '../../components/sync-indicator'

describe('SyncIndicator', () => {
	it('shows "Offline" when connectionState is offline, regardless of isSynced', () => {
		render(<SyncIndicator connectionState="offline" isSynced={false} />)
		expect(screen.getByText('Offline')).toBeDefined()
	})

	it('shows an optimistic "Connecting..." state (not "Offline") while reconnecting', () => {
		// This is the Render cold-start case: browser is online, websocket
		// hasn't connected yet. Must not read as an error state.
		render(<SyncIndicator connectionState="connecting" isSynced={false} />)
		expect(screen.getByText('Connecting...')).toBeDefined()
		expect(screen.queryByText('Offline')).toBeNull()
	})

	it('shows "Saving..." when connected but not yet synced', () => {
		render(<SyncIndicator connectionState="connected" isSynced={false} />)
		expect(screen.getByText('Saving...')).toBeDefined()
	})

	it('shows "Synced" when connected and synced', () => {
		render(<SyncIndicator connectionState="connected" isSynced={true} />)
		expect(screen.getByText('Synced')).toBeDefined()
	})
})
