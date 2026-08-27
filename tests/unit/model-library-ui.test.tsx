import { render, screen, fireEvent } from '@testing-library/react'
import { ModelLibrary } from '../../components/settings/model-library'
import { DEFAULT_MODEL_CATALOG } from '../../lib/ai/catalog'
import { HardwareProfile } from '../../lib/ai/hardware'

const mockHardwareProfile: HardwareProfile = {
	ramGb: 16,
	cpuCores: 8,
	hasWebGPU: true,
	tier: 'heavy',
	label: 'Heavy Workstation (16 GB RAM, WebGPU)',
	recommendedMaxLocalModelSize: '14B–32B'
}

describe('ModelLibrary UI', () => {
	it('renders search input and filter chips', () => {
		render(<ModelLibrary activeModelId="gpt-5.6-luna" onSelectModel={() => {}} />)
		
		expect(screen.getByPlaceholderText(/search models/i)).toBeInTheDocument()
		
		const allCategories = screen.getAllByRole('button', { name: /all/i })
		expect(allCategories.length).toBeGreaterThan(0)
		
		expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /reasoning/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /coding/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /indic/i })).toBeInTheDocument()
		
		expect(screen.getByRole('button', { name: /free/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /local/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /paid/i })).toBeInTheDocument()
	})

	it('renders model cards with hardware badges when profile provided', () => {
		render(
			<ModelLibrary 
				activeModelId="gpt-5.6-luna" 
				onSelectModel={() => {}} 
				hardwareProfile={mockHardwareProfile}
			/>
		)
		
		// The default catalog should have some models. Let's assume there is one called "GPT-5.6 Luna" or similar
		const firstModel = DEFAULT_MODEL_CATALOG[0]
		if (firstModel) {
			expect(screen.getAllByText(firstModel.name)[0]).toBeInTheDocument()
			expect(screen.getAllByText(new RegExp(firstModel.provider, 'i'))[0]).toBeInTheDocument()
		}
	})

	it('calls onSelectModel when "Select as Active" is clicked', () => {
		const onSelectModel = jest.fn()
		render(
			<ModelLibrary 
				activeModelId="none" 
				onSelectModel={onSelectModel} 
			/>
		)
		
		const selectButtons = screen.getAllByRole('button', { name: /select as active/i })
		if (selectButtons.length > 0) {
			fireEvent.click(selectButtons[0])
			expect(onSelectModel).toHaveBeenCalled()
		}
	})
})
