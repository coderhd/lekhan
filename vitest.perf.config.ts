import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Isolated perf budget run (`npm run test:perf`). Kept out of the default
 * `vitest.config.ts` suite so parallel test files cannot distort wall-clock
 * measurements.
 */
export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './'),
		},
	},
	test: {
		environment: 'node',
		globals: true,
		include: ['tests/perf/**/*.test.ts'],
	},
})
