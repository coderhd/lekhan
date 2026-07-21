process.env.SARVAM_API_KEY = 'mock-key'

// Mock localStorage
const mockStorage: Record<string, string> = {}
Object.defineProperty(window, 'localStorage', {
	value: {
		getItem: (key: string) => mockStorage[key] || null,
		setItem: (key: string, value: string) => { mockStorage[key] = value },
		removeItem: (key: string) => { delete mockStorage[key] },
		clear: () => { for (const key in mockStorage) delete mockStorage[key] }
	},
	writable: true
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation(query => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(), // deprecated
		removeListener: vi.fn(), // deprecated
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

