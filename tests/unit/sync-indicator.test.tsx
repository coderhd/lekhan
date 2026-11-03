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

	it('never shows a spinner for the known local-edits-only state', () => {
		// The ticket's headline rule: no spinner where the state is known.
		const { container } = render(
			<SyncIndicator
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(container.querySelector('.animate-spin')).toBeNull()
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

	it('never shows a spinner while connecting to the known cold-start state', () => {
		// #141: never a spinner where the state is known. The cold start is
		// known, so the copy carries the meaning and the icon stays static.
		const { container } = render(
			<SyncIndicator connectionState="connecting" isSynced={false} />
		)
		expect(container.querySelector('.animate-spin')).toBeNull()
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

	it('exposes the explanation to assistive technology, not only via title', () => {
		render(
			<SyncIndicator
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
			/>
		)
		expect(screen.getByText(/saved on this device/i)).toBeDefined()
	})

	it('only promises durability once local storage is ready', () => {
		render(
			<SyncIndicator
				connectionState="offline"
				isSynced={false}
				hasUnsyncedChanges={true}
				isLocalSynced={false}
			/>
		)
		expect(screen.getByTitle(/still in this tab/i)).toBeDefined()
		expect(screen.queryByTitle(/saved on this device/i)).toBeNull()
	})

	it('does not claim the user is offline when only the hub is unreachable', () => {
		render(<SyncIndicator connectionState="offline" isSynced={false} />)
		expect(screen.getByTitle(/can't reach the hub/i)).toBeDefined()
	})
})
