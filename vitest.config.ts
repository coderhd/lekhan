import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
	plugins: [react() as any],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './'),
		},
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./tests/unit/setup.ts'],
		globals: true,
		exclude: ['**/node_modules/**', '**/tests/e2e/**', '**/dist/**'],
	},
})
