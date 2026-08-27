import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import * as Y from 'yjs'
import { VisualDiffViewer } from '../../components/version-history/visual-diff-viewer'
import { RestoreConfirmDialog } from '../../components/version-history/restore-confirm-dialog'
import { VersionDrawer } from '../../components/version-history/version-drawer'

describe('VersionHistory UI', () => {
	describe('VisualDiffViewer', () => {
		it('renders additions and deletions correctly', () => {
			const previousText = 'hello world old text'
			const currentText = 'hello new world text'

			const { container } = render(
				<VisualDiffViewer previousText={previousText} currentText={currentText} />
			)

			const additions = container.querySelectorAll('.text-emerald-700')
			expect(additions.length).toBeGreaterThan(0)
			expect(additions[0].textContent).toContain('new')

			const deletions = container.querySelectorAll('.text-red-700')
			expect(deletions.length).toBeGreaterThan(0)
			expect(deletions[0].textContent).toContain('old')
		})

		it('handles identical text', () => {
			const text = 'hello world'
			const { container } = render(
				<VisualDiffViewer previousText={text} currentText={text} />
			)
			const additions = container.querySelectorAll('.text-emerald-700')
			const deletions = container.querySelectorAll('.text-red-700')
			expect(additions.length).toBe(0)
			expect(deletions.length).toBe(0)
			expect(container.textContent).toContain('hello world')
		})
	})

	describe('RestoreConfirmDialog', () => {
		it('calls onConfirm when restore is clicked', () => {
			const onConfirm = vi.fn()
			const onCancel = vi.fn()
			render(
				<RestoreConfirmDialog
					isOpen={true}
					onConfirm={onConfirm}
					onCancel={onCancel}
				/>
			)

			expect(screen.getByText(/Restoring will create a new version checkpoint/i)).toBeInTheDocument()

			fireEvent.click(screen.getByRole('button', { name: /restore checkpoint/i }))
			expect(onConfirm).toHaveBeenCalledTimes(1)
		})

		it('calls onCancel when cancel is clicked', () => {
			const onConfirm = vi.fn()
			const onCancel = vi.fn()
			render(
				<RestoreConfirmDialog
					isOpen={true}
					onConfirm={onConfirm}
					onCancel={onCancel}
				/>
			)

			fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
			expect(onCancel).toHaveBeenCalledTimes(1)
		})
	})

	describe('VersionDrawer', () => {
		let engineMock: any
		let currentYdoc: Y.Doc

		beforeEach(() => {
			currentYdoc = new Y.Doc()
			const xml = currentYdoc.getXmlFragment('default')
			const p = new Y.XmlElement('p')
			p.insert(0, [new Y.XmlText('current content')])
			xml.insert(0, [p])

			engineMock = {
				listVersions: vi.fn().mockResolvedValue([
					{
						id: '1',
						title: 'Milestone 1',
						authorName: 'Alice',
						authorId: 'user1',
						createdAt: new Date().toISOString(),
						isPinned: true,
						byteSize: 100,
						compressedPayload: new Uint8Array(),
					},
					{
						id: '2',
						title: 'Auto-save',
						authorName: 'Alice',
						authorId: 'user1',
						createdAt: new Date(Date.now() - 10000).toISOString(),
						isPinned: false,
						byteSize: 100,
						compressedPayload: new Uint8Array(),
					}
				]),
				getSnapshotText: vi.fn().mockResolvedValue('old snapshot content'),
				restoreCheckpoint: vi.fn().mockResolvedValue({}),
				createMilestone: vi.fn().mockResolvedValue({})
			}
		})

		it('lists versions and filters by milestone', async () => {
			render(
				<VersionDrawer
					isOpen={true}
					onClose={vi.fn()}
					pageId="page1"
					workspaceId="ws1"
					engine={engineMock}
					currentYdoc={currentYdoc}
					currentUser={{ id: 'user1', name: 'Alice' }}
				/>
			)

			await waitFor(() => {
				expect(screen.getByText('Milestone 1')).toBeInTheDocument()
				expect(screen.getByText('Auto-save')).toBeInTheDocument()
			})

			// Filter to milestones
			fireEvent.click(screen.getByRole('tab', { name: /milestones/i }))

			await waitFor(() => {
				expect(screen.getByText('Milestone 1')).toBeInTheDocument()
				expect(screen.queryByText('Auto-save')).not.toBeInTheDocument()
			})
		})

		it('triggers restore flow', async () => {
			const onRestored = vi.fn()
			render(
				<VersionDrawer
					isOpen={true}
					onClose={vi.fn()}
					pageId="page1"
					workspaceId="ws1"
					engine={engineMock}
					currentYdoc={currentYdoc}
					currentUser={{ id: 'user1', name: 'Alice' }}
					onRestored={onRestored}
				/>
			)

			await waitFor(() => {
				expect(screen.getByText('Milestone 1')).toBeInTheDocument()
			})

			// Click milestone to open diff
			fireEvent.click(screen.getByText('Milestone 1'))

			await waitFor(() => {
				// Should display diff
				expect(engineMock.getSnapshotText).toHaveBeenCalled()
			})
			
			// Click restore
			const restoreBtns = screen.getAllByRole('button', { name: /restore/i })
			fireEvent.click(restoreBtns[restoreBtns.length - 1])

			// Confirm restore
			const confirmBtn = screen.getByRole('button', { name: /restore checkpoint/i })
			fireEvent.click(confirmBtn)

			await waitFor(() => {
				expect(engineMock.restoreCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
					pageId: 'page1',
					checkpointId: '1'
				}))
				expect(onRestored).toHaveBeenCalled()
			})
		})

		it('hides milestone creation and restore actions when isReadOnly is true', async () => {
			render(
				<VersionDrawer
					isOpen={true}
					onClose={vi.fn()}
					pageId="page1"
					workspaceId="ws1"
					engine={engineMock}
					currentYdoc={currentYdoc}
					currentUser={{ id: 'user1', name: 'Alice' }}
					isReadOnly={true}
				/>
			)

			await waitFor(() => {
				expect(screen.getByText('Milestone 1')).toBeInTheDocument()
			})

			// New Milestone form should not be present
			expect(screen.queryByPlaceholderText(/milestone name/i)).not.toBeInTheDocument()
			expect(screen.queryByRole('button', { name: /new milestone/i })).not.toBeInTheDocument()

			// Click milestone to select
			fireEvent.click(screen.getByText('Milestone 1'))

			await waitFor(() => {
				expect(engineMock.getSnapshotText).toHaveBeenCalled()
			})

			// Restore button should not be present
			expect(screen.queryByRole('button', { name: /^restore$/i })).not.toBeInTheDocument()
		})
	})
})
