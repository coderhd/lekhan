import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorCollab } from '../../hooks/use-editor-collab'

type Listener = (...args: unknown[]) => void

let createdProviders: FakeWebsocketProvider[] = []

class FakeAwareness {
	listeners: Record<string, Listener[]> = {}
	states = new Map<string, unknown>()
	setLocalStateField = vi.fn()
	getStates() {
		return this.states
	}
	on(event: string, cb: Listener) {
		this.listeners[event] = this.listeners[event] || []
		this.listeners[event].push(cb)
	}
	off(event: string, cb: Listener) {
		this.listeners[event] = (this.listeners[event] || []).filter((fn) => fn !== cb)
	}
	emit(event: string, ...args: unknown[]) {
		;(this.listeners[event] || []).forEach((cb) => cb(...args))
	}
}

class FakeWebsocketProvider {
	listeners: Record<string, Listener[]> = {}
	awareness = new FakeAwareness()
	constructor(public url: string, public roomName: string, public doc: unknown, public opts: unknown) {
		createdProviders.push(this)
	}
	on(event: string, cb: Listener) {
		this.listeners[event] = this.listeners[event] || []
		this.listeners[event].push(cb)
	}
	emit(event: string, ...args: unknown[]) {
		;(this.listeners[event] || []).forEach((cb) => cb(...args))
	}
	destroy() {}
}

class FakeIndexeddbPersistence {
	on() {}
	destroy() {}
}

vi.mock('y-websocket', () => ({
	WebsocketProvider: FakeWebsocketProvider,
}))
vi.mock('y-indexeddb', () => ({
	IndexeddbPersistence: FakeIndexeddbPersistence,
}))

async function setup() {
	const { result, unmount } = renderHook(() =>
		useEditorCollab('doc-1', 'token-1', { id: 'u1', name: 'User', color: '#ffffff' })
	)
	// Let the Promise.all([import('y-websocket'), import('y-indexeddb')]) resolve
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
	return { result, unmount }
}

describe('useEditorCollab optimistic connection state', () => {
	beforeEach(() => {
		createdProviders = []
		vi.useFakeTimers()
		Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('starts in "connecting" state', async () => {
		const { result } = await setup()
		expect(result.current.connectionState).toBe('connecting')
		expect(result.current.isOffline).toBe(false)
	})

	it('goes to "connected" once the websocket reports connected', async () => {
		const { result } = await setup()
		const provider = createdProviders[0]
		act(() => {
			provider.emit('status', { status: 'connected' })
		})
		expect(result.current.connectionState).toBe('connected')
	})

	it('stays optimistic ("connecting", not "offline") throughout a ~50s Render cold start', async () => {
		const { result } = await setup()
		const provider = createdProviders[0]

		act(() => {
			provider.emit('status', { status: 'connecting' })
		})
		expect(result.current.connectionState).toBe('connecting')

		// Advance 45s — still within Render's documented ~50s cold-start window
		act(() => {
			vi.advanceTimersByTime(45_000)
		})
		expect(result.current.connectionState).toBe('connecting')

		// Server wakes up and the websocket connects
		act(() => {
			provider.emit('status', { status: 'connected' })
		})
		expect(result.current.connectionState).toBe('connected')
	})

	it('falls back to "offline" if the websocket never connects within the grace period', async () => {
		const { result } = await setup()
		const provider = createdProviders[0]

		act(() => {
			provider.emit('status', { status: 'connecting' })
		})
		act(() => {
			vi.advanceTimersByTime(60_000)
		})
		expect(result.current.connectionState).toBe('offline')
	})

	it('recovers to "connected" if the server comes up after the grace period already elapsed', async () => {
		const { result } = await setup()
		const provider = createdProviders[0]

		act(() => {
			provider.emit('status', { status: 'connecting' })
		})
		act(() => {
			vi.advanceTimersByTime(60_000)
		})
		expect(result.current.connectionState).toBe('offline')

		// y-websocket keeps retrying in the background even after we've
		// shown "offline" — if it connects late, we should reflect that.
		act(() => {
			provider.emit('status', { status: 'connected' })
		})
		expect(result.current.connectionState).toBe('connected')
	})

	it('goes straight to "offline" (skipping the grace period) if the browser itself has no network', async () => {
		const { result } = await setup()

		act(() => {
			Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
			window.dispatchEvent(new Event('offline'))
		})
		expect(result.current.connectionState).toBe('offline')
	})

	it('re-evaluates as "connecting" when the browser comes back online but the websocket is not yet connected', async () => {
		const { result } = await setup()

		act(() => {
			Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
			window.dispatchEvent(new Event('offline'))
		})
		expect(result.current.connectionState).toBe('offline')

		act(() => {
			Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
			window.dispatchEvent(new Event('online'))
		})
		expect(result.current.connectionState).toBe('connecting')
	})

	// SIL-230 / #144. `yCursorPlugin` rewrites the local awareness `cursor`
	// field on every view update — i.e. once per keystroke. That fires
	// awareness `change` events even though the *presence list* is unchanged.
	// Publishing a fresh `activeUsers` array for those re-rendered the whole
	// editor workspace per character; the reference must stay stable.
	it('keeps the activeUsers reference stable when only cursor awareness changes', async () => {
		const { result } = await setup()
		const awareness = createdProviders[0].awareness

		awareness.states.set('1', { user: { id: 'u1', name: 'User', color: '#ffffff' } })
		act(() => {
			awareness.emit('change')
		})
		const first = result.current.activeUsers
		expect(first).toEqual([{ id: 'u1', name: 'User', color: '#ffffff' }])

		// Simulate 38 per-keystroke awareness events with the same presence.
		act(() => {
			for (let i = 0; i < 38; i++) awareness.emit('change')
		})
		expect(result.current.activeUsers).toBe(first)

		// A real presence change still publishes.
		awareness.states.set('2', { user: { id: 'u2', name: 'Other', color: '#000000' } })
		act(() => {
			awareness.emit('change')
		})
		expect(result.current.activeUsers).not.toBe(first)
		expect(result.current.activeUsers).toHaveLength(2)
	})
})
