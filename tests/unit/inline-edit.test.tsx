import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineEdit } from '@/components/inline-edit'

describe('Page title actions', () => {
 it('names edit and cancel correctly and cancels without saving', () => {
  const onSave = vi.fn()
  render(<InlineEdit initialValue="Original title" onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit page title' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), { target: { value: 'Unsaved title' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel title editing' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('Original title')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
 })
})
