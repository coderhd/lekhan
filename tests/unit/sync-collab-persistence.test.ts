import { describe, it, expect, vi } from 'vitest'

// Use the same CJS Yjs build as `server/collab-persistence.js`; mixing the ESM
// build in the test makes Yjs warn about duplicate constructor identities.
const Y = require('yjs')
const { createCollabPersistence, markWritable } = require('../../server/collab-persistence.js')

// ---------------------------------------------------------------------------
// SIL-214 B2 — hydration-gated persistence. A room must never be written
// before `bindState` applied the stored snapshot, and a room that only ever
// had read-only (export) connections must never be written at all.
// ---------------------------------------------------------------------------

const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }

function seedState(text: string): Uint8Array {
	const seed = new Y.Doc()
	seed.getText('default').insert(0, text)
	const state = Y.encodeStateAsUpdate(seed)
	seed.destroy()
	return state
}

function setup(overrides: Partial<{ loadState: any; persistState: any }> = {}) {
	const persistState = overrides.persistState ?? vi.fn().mockResolvedValue(undefined)
	const scheduleSave = vi.fn()
	const clearSave = vi.fn()
	const persistence = createCollabPersistence({
		loadState: overrides.loadState ?? (async () => seedState('stored body')),
		persistState,
		scheduleSave,
		clearSave,
		logger: silentLogger,
	})
	return { persistence, persistState, scheduleSave, clearSave }
}

describe('createCollabPersistence', () => {
	it('applies the stored snapshot and marks the room hydrated', async () => {
		const { persistence } = setup()
		const doc = new Y.Doc()

		await persistence.bindState('page-1', doc)

		expect(doc.__hydration.status).toBe('hydrated')
		expect(doc.getText('default').toString()).toBe('stored body')
	})

	it('does not save a room before hydration (pending)', async () => {
		const { persistence, persistState } = setup()
		const doc = new Y.Doc()
		markWritable(doc)

		await persistence.writeState('page-1', doc)

		expect(persistState).not.toHaveBeenCalled()
		expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining('hydration is not started'))
	})

	it('does not save a hydrated room that only had read-only connections (B2)', async () => {
		const { persistence, persistState } = setup()
		const doc = new Y.Doc()
		await persistence.bindState('page-1', doc)

		await persistence.writeState('page-1', doc)

		expect(persistState).not.toHaveBeenCalled()
	})

	it('saves a hydrated room once a writable connection was admitted', async () => {
		const { persistence, persistState } = setup()
		const doc = new Y.Doc()
		await persistence.bindState('page-1', doc)
		markWritable(doc)
		doc.getText('default').insert(0, ' edited')

		await persistence.writeState('page-1', doc)

		expect(persistState).toHaveBeenCalledWith('page-1', doc)
	})

	it('treats a missing snapshot (404) as a hydrated new Page, not a failure', async () => {
		const { persistence, persistState } = setup({ loadState: async () => null })
		const doc = new Y.Doc()

		await persistence.bindState('page-1', doc)
		markWritable(doc)
		await persistence.writeState('page-1', doc)

		expect(doc.__hydration.status).toBe('hydrated')
		expect(persistState).toHaveBeenCalled()
	})

	it('refuses to save when hydration failed, even for a writable room', async () => {
		const { persistence, persistState } = setup({
			loadState: async () => {
				throw new Error('storage down')
			},
		})
		const doc = new Y.Doc()

		await persistence.bindState('page-1', doc)
		markWritable(doc)
		await persistence.writeState('page-1', doc)

		expect(doc.__hydration.status).toBe('failed')
		expect(persistState).not.toHaveBeenCalled()
		expect(silentLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('writes disabled to protect the stored snapshot'),
			expect.any(Error),
		)
	})

	it('schedules a save for edits but not for the hydration update itself', async () => {
		const { persistence, scheduleSave } = setup()
		const doc = new Y.Doc()

		await persistence.bindState('page-1', doc)
		expect(scheduleSave).not.toHaveBeenCalled()

		doc.getText('default').insert(0, ' typed')
		expect(scheduleSave).toHaveBeenCalledWith('page-1', doc)
	})

	it('clears pending debounce timers before writing', async () => {
		const { persistence, clearSave } = setup()
		const doc = new Y.Doc()
		await persistence.bindState('page-1', doc)
		markWritable(doc)

		await persistence.writeState('page-1', doc)

		expect(clearSave).toHaveBeenCalledWith('page-1')
	})

	it('swallows a persistence error so y-websocket can still destroy the room', async () => {
		const { persistence } = setup({
			persistState: vi.fn().mockRejectedValue(new Error('upload failed')),
		})
		const doc = new Y.Doc()
		await persistence.bindState('page-1', doc)
		markWritable(doc)

		await expect(persistence.writeState('page-1', doc)).resolves.toBeUndefined()
		expect(silentLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to save page-1'),
			expect.any(Error),
		)
	})
})
