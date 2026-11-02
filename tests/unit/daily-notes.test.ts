import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
	dailyTag,
	dailyTitle,
	fetchDailyPages,
	ensureDailyPage,
	isDailyPage,
	shiftDailyDate,
} from '@/lib/daily-notes'
import type { Workspace } from '@/types'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn(),
		then: vi.fn(),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})

const mockBuilder = (supabase.from as any)() as any

const workspace = {
	id: 'ws-1',
	name: 'My Workspace',
	owner_id: 'user-1',
	is_team: false,
	created_at: '',
	updated_at: '',
} satisfies Workspace

let selectResults: Array<{ data: unknown; error: unknown }>
let singleResult: { data: unknown; error: unknown }

beforeEach(() => {
	vi.resetAllMocks()
	selectResults = []
	singleResult = { data: null, error: null }

	;(supabase.from as any).mockReturnValue(mockBuilder)
	mockBuilder.select.mockReturnValue(mockBuilder)
	mockBuilder.insert.mockReturnValue(mockBuilder)
	mockBuilder.eq.mockReturnValue(mockBuilder)
	mockBuilder.in.mockReturnValue(mockBuilder)
	mockBuilder.order.mockReturnValue(mockBuilder)
	mockBuilder.single.mockImplementation(() => Promise.resolve(singleResult))
	mockBuilder.then.mockImplementation((onFulfilled: any) =>
		Promise.resolve(selectResults.shift() ?? { data: [], error: null }).then(onFulfilled)
	)
})

describe('dailyTitle', () => {
	it('formats a local date as zero-padded YYYY-MM-DD', () => {
		expect(dailyTitle(new Date(2026, 0, 5))).toBe('2026-01-05')
		expect(dailyTitle(new Date(2026, 9, 2))).toBe('2026-10-02')
		expect(dailyTitle(new Date(2026, 11, 31))).toBe('2026-12-31')
	})

	it('uses the client-local calendar day, not the UTC day', () => {
		// 2026-01-01 00:30 local is still 2025-12-31 in UTC for positive-offset
		// zones; the daily page must name the day the user is actually in.
		const localNewYear = new Date(2026, 0, 1, 0, 30, 0)
		expect(dailyTitle(localNewYear)).toBe('2026-01-01')
	})
})

describe('dailyTag', () => {
	it('is the canonical lowercase daily tag', () => {
		expect(dailyTag).toBe('daily')
	})
})

describe('shiftDailyDate', () => {
	it('moves one day forward across a month boundary', () => {
		expect(dailyTitle(shiftDailyDate(new Date(2026, 9, 31), 1))).toBe('2026-11-01')
	})

	it('moves one day back across a month boundary', () => {
		expect(dailyTitle(shiftDailyDate(new Date(2026, 2, 1), -1))).toBe('2026-02-28')
	})

	it('returns local midnight so day arithmetic never drifts across DST', () => {
		const shifted = shiftDailyDate(new Date(2026, 2, 29, 23, 45), 1)
		expect(shifted.getHours()).toBe(0)
		expect(shifted.getMinutes()).toBe(0)
		expect(dailyTitle(shifted)).toBe('2026-03-30')
	})
})

describe('isDailyPage', () => {
	it('recognizes the properties.daily marker written on creation', () => {
		expect(isDailyPage({ properties: { daily: true } })).toBe(true)
	})

	it('recognizes the properties.tags daily marker', () => {
		expect(isDailyPage({ properties: { tags: ['daily'] } })).toBe(true)
		expect(isDailyPage({ properties: { tags: 'daily, work' } })).toBe(true)
	})

	it('recognizes a graph-indexed #daily page tag', () => {
		expect(isDailyPage({ properties: {}, page_tags: [{ tag: 'daily' }] })).toBe(true)
	})

	it('rejects any other page', () => {
		expect(isDailyPage({ properties: {} })).toBe(false)
		expect(isDailyPage({ properties: { tags: ['weekly'] } })).toBe(false)
		expect(isDailyPage({ properties: {}, page_tags: [{ tag: 'work' }] })).toBe(false)
	})
})

describe('ensureDailyPage', () => {
	it('reuses the existing #daily page with the exact date title', async () => {
		const existing = {
			id: 'page-daily',
			workspace_id: 'ws-1',
			title: '2026-11-02',
			properties: { daily: true, tags: ['daily'] },
		}
		selectResults.push({ data: [existing], error: null })

		const page = await ensureDailyPage(workspace, new Date(2026, 10, 2))

		expect(page).toEqual(existing)
		expect(mockBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(mockBuilder.eq).toHaveBeenCalledWith('title', '2026-11-02')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
	})

	it('never creates a second page when ensureDailyPage is called twice', async () => {
		const existing = { id: 'page-daily', title: '2026-11-02', properties: { daily: true } }
		selectResults.push({ data: [existing], error: null })
		selectResults.push({ data: [existing], error: null })

		const first = await ensureDailyPage(workspace, new Date(2026, 10, 2))
		const second = await ensureDailyPage(workspace, new Date(2026, 10, 2))

		expect(first.id).toBe('page-daily')
		expect(second.id).toBe('page-daily')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
	})

	it('creates the missing daily page with the exact title and daily marker', async () => {
		const created = {
			id: 'page-new',
			workspace_id: 'ws-1',
			title: '2026-11-02',
			properties: { daily: true, tags: ['daily'] },
		}
		singleResult = { data: created, error: null }

		const page = await ensureDailyPage(workspace, new Date(2026, 10, 2))

		expect(page).toEqual(created)
		expect(mockBuilder.insert).toHaveBeenCalledTimes(1)
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			workspace_id: 'ws-1',
			owner_id: 'user-1',
			parent_id: null,
			title: '2026-11-02',
			properties: { daily: true, tags: ['daily'] },
		})
	})

	it('does not reuse a same-titled page that is not a daily page', async () => {
		selectResults.push({
			data: [{ id: 'page-other', title: '2026-11-02', properties: {} }],
			error: null,
		})
		singleResult = {
			data: { id: 'page-new', title: '2026-11-02', properties: { daily: true } },
			error: null,
		}

		const page = await ensureDailyPage(workspace, new Date(2026, 10, 2))

		expect(page.id).toBe('page-new')
		expect(mockBuilder.insert).toHaveBeenCalledTimes(1)
	})

	it('collapses concurrent calls into one create (no duplicate pages)', async () => {
		singleResult = {
			data: { id: 'page-new', title: '2026-11-02', properties: { daily: true } },
			error: null,
		}

		const [first, second] = await Promise.all([
			ensureDailyPage(workspace, new Date(2026, 10, 2)),
			ensureDailyPage(workspace, new Date(2026, 10, 2)),
		])

		expect(first.id).toBe('page-new')
		expect(second.id).toBe('page-new')
		expect(mockBuilder.insert).toHaveBeenCalledTimes(1)
	})

	it('propagates lookup errors without creating a page', async () => {
		selectResults.push({ data: null, error: { message: 'lookup failed' } })

		await expect(ensureDailyPage(workspace, new Date(2026, 10, 2))).rejects.toThrow('lookup failed')
		expect(mockBuilder.insert).not.toHaveBeenCalled()
	})

	it('propagates create errors', async () => {
		singleResult = { data: null, error: { message: 'insert failed' } }

		await expect(ensureDailyPage(workspace, new Date(2026, 10, 2))).rejects.toThrow('insert failed')
		expect(mockBuilder.insert).toHaveBeenCalledTimes(1)
	})

	it('retries the lookup after a failed create instead of caching the failure', async () => {
		singleResult = { data: null, error: { message: 'insert failed' } }
		await expect(ensureDailyPage(workspace, new Date(2026, 10, 2))).rejects.toThrow('insert failed')

		singleResult = {
			data: { id: 'page-new', title: '2026-11-02', properties: { daily: true } },
			error: null,
		}
		const page = await ensureDailyPage(workspace, new Date(2026, 10, 2))

		expect(page.id).toBe('page-new')
		expect(mockBuilder.insert).toHaveBeenCalledTimes(2)
	})
})

describe('fetchDailyPages', () => {
	it('returns a title-keyed map of daily pages in the requested window', async () => {
		selectResults.push({
			data: [
				{ id: 'p-1', title: '2026-11-01', properties: { daily: true } },
				{ id: 'p-2', title: '2026-11-03', properties: {}, page_tags: [{ tag: 'daily' }] },
				{ id: 'p-3', title: '2026-11-04', properties: {} },
			],
			error: null,
		})

		const pages = await fetchDailyPages('ws-1', [
			new Date(2026, 10, 1),
			new Date(2026, 10, 2),
			new Date(2026, 10, 3),
			new Date(2026, 10, 4),
		])

		expect(pages.get('2026-11-01')?.id).toBe('p-1')
		expect(pages.get('2026-11-03')?.id).toBe('p-2')
		expect(pages.has('2026-11-04')).toBe(false)
		expect(mockBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(mockBuilder.in).toHaveBeenCalledWith('title', [
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
		])
	})

	it('propagates query errors so callers can recover', async () => {
		selectResults.push({ data: null, error: { message: 'dots failed' } })

		await expect(fetchDailyPages('ws-1', [new Date(2026, 10, 2)])).rejects.toThrow('dots failed')
	})
})
