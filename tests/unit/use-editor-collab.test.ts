import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorCollab } from '../../hooks/use-editor-collab'

type Listener = (...args: unknown[]) => void

let createdProviders: FakeWebsocketProvider[] = []

class FakeAwareness {
	listeners: Record<string, Listener[]> = {}
	setLocalStateField = vi.fn()
	getStates() {
		return new Map()
	}
	on(event: string, cb: Listener) {
		this.listeners[event] = this.listeners[event] || []
		this.listeners[event].push(cb)
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
})
