import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { forgetCloudSearchPage, readCloudSearchPages, rememberCloudSearchPage, subscribeCloudSearchPages } from '../../lib/cloud/local-search'
import { workspaceSearch } from '../../lib/workspace-search'

describe('search across cloud copies on the device', () => {
  it('indexes titles, body text, and graph terms while keeping accounts isolated', async () => {
    const page = {
      id: 'same-page', title: 'Field notebook',
      markdown: 'A short observation about juniper. #botany [[Herbarium]] ![leaf](data:image/png;base64,KPRIVATEA==)',
      properties: { tags: ['perennial'], privateField: 'not needed for search' },
      updatedAt: '2026-11-24T00:00:00.000Z',
    }
    await rememberCloudSearchPage('first-account', page)
    await rememberCloudSearchPage('second-account', { ...page, title: 'Shared copy', markdown: 'Different draft' })
    const own = await readCloudSearchPages('first-account')
    expect(own).toHaveLength(1)
    expect(own[0].markdown).not.toContain('KPRIVATEA')
    expect(own[0].properties).toEqual({ tags: ['perennial'] })
    const index = workspaceSearch(own)
    for (const query of ['Field notebook', 'juniper', '#botany', '#perennial', 'Herbarium']) {
      expect(index.query(query).map(hit => hit.page.id)).toEqual(['same-page'])
    }
    expect(workspaceSearch(await readCloudSearchPages('second-account')).query('juniper')).toEqual([])
    expect(await readCloudSearchPages('unknown-account')).toEqual([])
  })

  it('updates an existing entry and removes a denied copy for just that account', async () => {
    const page = { id: 'known', title: 'Earlier title', markdown: 'saved paragraph', updatedAt: '2026-11-24T00:00:00.000Z' }
    const notify = vi.fn()
    const unsubscribe = subscribeCloudSearchPages('viewer', notify)
    await rememberCloudSearchPage('writer', page)
    await rememberCloudSearchPage('viewer', page)
    await rememberCloudSearchPage('writer', { ...page, title: 'New title', markdown: 'revised paragraph' })
    expect(notify).toHaveBeenCalledOnce()
    expect(await readCloudSearchPages('writer')).toMatchObject([{ id: page.id, title: 'New title', markdown: 'revised paragraph' }])
    await forgetCloudSearchPage('viewer', page.id)
    expect(notify).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(await readCloudSearchPages('viewer')).toEqual([])
    expect(await readCloudSearchPages('writer')).toHaveLength(1)
  })
})
