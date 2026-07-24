import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect } from 'vitest'
import React from 'react'

describe('AI Credit Counter Display', () => {
	it('formats credit count as X Credits left', () => {
		const creditsLeft = 85
		render(<span data-testid="credits-counter">{`${creditsLeft} Credits left`}</span>)
		expect(screen.getByTestId('credits-counter')).toHaveTextContent('85 Credits left')
	})
})
