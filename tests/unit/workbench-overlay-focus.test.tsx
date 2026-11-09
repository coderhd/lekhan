import '@testing-library/jest-dom'
import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import GlobalSearchPalette, { useGlobalSearch } from '@/components/global-search-palette'
import QuickCapturePalette, { useQuickCapture } from '@/components/quick-capture-palette'
import WorkbenchShell from '@/components/workbench/workbench-shell'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
 getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })),
 onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
} } }))
vi.mock('@/components/session-reauth-provider', () => ({ useSessionReauth: () => ({ isLocked: false }) }))
vi.mock('@/services/search', () => ({ fetchRecentPages: vi.fn(async () => []), searchPages: vi.fn(async () => []) }))

function Workspace() {
 const search = useGlobalSearch()
 const capture = useQuickCapture()
 return <GlobalHeaderProvider><WorkbenchShell active="workspace" workspaceName="My workspace" onSearch={search.open} onCapture={capture.open}><input aria-label="Draft" defaultValue="Keep writing" /></WorkbenchShell></GlobalHeaderProvider>
}

describe('Mobile navigation overlay handoff', () => {
 it.each([
  ['Search', 'Search pages'],
  ['Quick capture', 'Quick capture'],
 ])('returns focus to navigation after opening and closing %s', async (action, dialogName) => {
  render(<QuickCapturePalette><GlobalSearchPalette><Workspace /></GlobalSearchPalette></QuickCapturePalette>)
  await act(async () => {})
  const trigger = screen.getByRole('button', { name: 'Open workspace navigation' })
  trigger.focus()
  fireEvent.click(trigger)
  const navigation = screen.getByRole('dialog', { name: 'Workspace navigation' })
  const menuAction = within(navigation).getByRole('button', { name: action })
  menuAction.focus()
  fireEvent.click(menuAction)
  await screen.findByRole('dialog', { name: dialogName })
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep writing')
 })
})
