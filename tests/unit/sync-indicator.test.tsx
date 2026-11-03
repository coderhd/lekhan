import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SyncIndicator from '../../components/sync-indicator'

describe('SyncIndicator', () => {
	it('shows "Offline" when offline with no pending local edits', () => {
		render(<SyncIndicator connectionState="offline" isSynced={false} />)
		expect(screen.getByText('Offline')).toBeDefined()
	})

	it('shows "Local edits only" when offline with durable edits awaiting the hub', () => {
		// The edit already survived the IndexedDB round-trip. Telling the person
		// only "Offline" hides the reassuring fact that their work is safe.
		render(
			<SyncIndicator
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(screen.getByText('Local edits only')).toBeDefined()
		expect(screen.queryByText('Offline')).toBeNull()
	})

	it('shows "Local edits only" during the hub cold start when edits are pending', () => {
		render(
			<SyncIndicator
				connectionState="connecting"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(screen.getByText('Local edits only')).toBeDefined()
	})

	it('shows an honest "Connecting to hub..." state while the hub wakes', () => {
		// Render cold start: the browser is online, the hub is not up yet.
		// Must not read as an error state, and must not pretend to know less
		// than it does — the copy names the hub and the known cold start.
		render(<SyncIndicator connectionState="connecting" isSynced={false} />)
		expect(screen.getByText('Connecting to hub...')).toBeDefined()
		expect(screen.queryByText('Offline')).toBeNull()
	})

	it('explains the known cold-start window in the connecting tooltip', () => {
		render(<SyncIndicator connectionState="connecting" isSynced={false} />)
		expect(screen.getByTitle(/minute/i)).toBeDefined()
	})

	it('shows "Saving..." when connected but not yet synced, even with pending edits', () => {
		// While connected, an in-flight convert is the accurate description;
		// "Local edits only" would imply nothing is happening.
		render(
			<SyncIndicator
				connectionState="connected"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(screen.getByText('Saving...')).toBeDefined()
		expect(screen.queryByText('Local edits only')).toBeNull()
	})

	it('shows "Synced" when connected and synced', () => {
		render(<SyncIndicator connectionState="connected" isSynced={true} />)
		expect(screen.getByText('Synced')).toBeDefined()
	})

	it('announces state changes to assistive technology', () => {
		render(<SyncIndicator connectionState="connected" isSynced={true} />)
		const status = screen.getByRole('status')
		expect(status.getAttribute('aria-live')).toBe('polite')
	})

	it('explains that pending edits are kept on this device', () => {
		render(
			<SyncIndicator
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(screen.getByTitle(/this device/i)).toBeDefined()
	})
})
