import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
	INBOX_WINDOW_DAYS,
	fetchInboxItems,
	inboxWindowDates,
	pendingInboxLines,
} from '@/lib/inbox'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		then: vi.fn(),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})

const mockBuilder = (supabase.from as any)() as any

const NOW = new Date(2026, 10, 2, 12, 0, 0) // 2026-11-02 local

let selectResult: { data: unknown; error: unknown }

beforeEach(() => {
	vi.resetAllMocks()
	selectResult = { data: [], error: null }

	;(supabase.from as any).mockReturnValue(mockBuilder)
	mockBuilder.select.mockReturnValue(mockBuilder)
	mockBuilder.eq.mockReturnValue(mockBuilder)
	mockBuilder.in.mockReturnValue(mockBuilder)
	mockBuilder.order.mockReturnValue(mockBuilder)
	mockBuilder.then.mockImplementation((onFulfilled: any) =>
		Promise.resolve(selectResult).then(onFulfilled)
	)
})

const dailyRow = (overrides: Record<string, any> = {}) => ({
	id: 'page-1',
	workspace_id: 'ws-1',
	title: '2026-11-02',
	properties: { daily: true },
	page_tags: [],
	searchable_text: '',
	...overrides,
})

describe('inboxWindowDates', () => {
	it('returns 14 local days ending today, today first', () => {
		const dates = inboxWindowDates(NOW)

		expect(INBOX_WINDOW_DAYS).toBe(14)
		expect(dates).toHaveLength(14)
		expect(dates[0].getDate()).toBe(2)
		expect(dates[13].getDate()).toBe(20)
		expect(dates[13].getMonth()).toBe(9) // October
	})

	it('crosses a month boundary in local time', () => {
		const dates = inboxWindowDates(new Date(2026, 10, 1), 3)

		expect(dates.map(date => `${date.getMonth() + 1}-${date.getDate()}`)).toEqual([
			'11-1',
			'10-31',
			'10-30',
		])
	})
})

describe('pendingInboxLines', () => {
	it('keeps only lines that still carry the #inbox marker', () => {
		const text = [
			'heading',
			'09:41 Buy milk #inbox',
			'10:15 Call Alice [[Alice]] #inbox',
			'10:20 Linked item [[Project]]',
			'',
		].join('\n')

		expect(pendingInboxLines(text)).toEqual([
			'09:41 Buy milk #inbox',
			'10:15 Call Alice [[Alice]] #inbox',
		])
	})

	it('strips markdown bullet prefixes and matches the tag case-insensitively', () => {
		expect(pendingInboxLines('- 09:41 first #INBOX\n* 09:42 second #Inbox.')).toEqual([
			'09:41 first #INBOX',
			'09:42 second #Inbox.',
		])
	})

	it('does not count lookalike tags such as #inboxing', () => {
		expect(pendingInboxLines('09:41 #inboxing is not a capture')).toEqual([])
		expect(pendingInboxLines('09:41 #inbox_notes is not a capture')).toEqual([])
		expect(pendingInboxLines('09:41 #inbox-2026 is not a capture')).toEqual([])
		expect(pendingInboxLines('09:41 #inbox/foo is not a capture')).toEqual([])
	})

	it('counts punctuation-terminated tags like the graph index does', () => {
		expect(pendingInboxLines('09:41 #inbox*')).toEqual(['09:41 #inbox*'])
		expect(pendingInboxLines('09:41 (see #inbox)')).toEqual(['09:41 (see #inbox)'])
	})

	it('tolerates an empty or missing body', () => {
		expect(pendingInboxLines('')).toEqual([])
		expect(pendingInboxLines(null)).toEqual([])
		expect(pendingInboxLines(undefined)).toEqual([])
	})
})

describe('fetchInboxItems', () => {
	it('counts every pending #inbox bullet across the last 14 daily pages', async () => {
		selectResult = {
			data: [
				dailyRow({
					id: 'today',
					title: '2026-11-02',
					searchable_text: [
						'2026-11-02',
						'Inbox',
						'09:41 Buy milk #inbox',
						'10:15 Call Alice #inbox',
						'10:20 Linked item [[Project]]',
					].join('\n'),
				}),
				dailyRow({
					id: 'yesterday',
					title: '2026-11-01',
					searchable_text: [
						'2026-11-01',
						'Inbox',
						'18:00 Ship the release #inbox',
					].join('\n'),
				}),
			],
			error: null,
		}

		const items = await fetchInboxItems('ws-1', { now: NOW })

		expect(items).toHaveLength(3)
		expect(items.map(item => item.text)).toEqual([
			'10:15 Call Alice #inbox',
			'09:41 Buy milk #inbox',
			'18:00 Ship the release #inbox',
		])
		expect(items[0]).toMatchObject({ pageId: 'today', pageTitle: '2026-11-02' })
	})

	it('queries the last 14 daily titles for the workspace, including searchable text', async () => {
		selectResult = { data: [], error: null }

		await fetchInboxItems('ws-1', { now: NOW })

		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.select).toHaveBeenCalledWith('*, page_tags (tag)')
		expect(mockBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		const [column, titles] = mockBuilder.in.mock.calls[0]
		expect(column).toBe('title')
		expect(titles).toHaveLength(14)
		expect(titles[0]).toBe('2026-11-02')
		expect(titles[13]).toBe('2026-10-20')
	})

	it('ignores pages that are not daily pages even when their title matches', async () => {
		selectResult = {
			data: [
				dailyRow({
					id: 'not-daily',
					title: '2026-11-02',
					properties: {},
					searchable_text: '09:41 Buy milk #inbox',
				}),
				dailyRow({
					id: 'imported-daily',
					title: '2026-11-01',
					properties: {},
					page_tags: [{ tag: 'daily' }],
					searchable_text: '09:41 Keep this #inbox',
				}),
			],
			error: null,
		}

		const items = await fetchInboxItems('ws-1', { now: NOW })

		expect(items).toEqual([
			{ pageId: 'imported-daily', pageTitle: '2026-11-01', text: '09:41 Keep this #inbox' },
		])
	})

	it('caps the returned items when a limit is requested (the card top five)', async () => {
		selectResult = {
			data: [
				dailyRow({
					id: 'today',
					title: '2026-11-02',
					searchable_text: Array.from({ length: 7 }, (_, i) => `0${i}:00 item ${i} #inbox`).join('\n'),
				}),
			],
			error: null,
		}

		const items = await fetchInboxItems('ws-1', { now: NOW, limit: 5 })

		expect(items).toHaveLength(5)
		expect(items.map(item => item.text)).toEqual([
			'06:00 item 6 #inbox',
			'05:00 item 5 #inbox',
			'04:00 item 4 #inbox',
			'03:00 item 3 #inbox',
			'02:00 item 2 #inbox',
		])
	})

	it('propagates a query error instead of showing an empty inbox', async () => {
		selectResult = { data: null, error: new Error('permission denied') }

		await expect(fetchInboxItems('ws-1', { now: NOW })).rejects.toThrow('permission denied')
	})
})
