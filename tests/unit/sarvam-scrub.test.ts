import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Exclusive Sarvam AI Reference Audit Across App', () => {
	it('ensures core AI files contain zero references to Gemini', () => {
		const filesToAudit = [
			'components/byok-settings.tsx',
			'components/pricing-plans.tsx',
			'components/ai-settings-panel.tsx',
			'components/settings-client.tsx',
			'components/lekhan-bot-bar.tsx',
			'lib/ai-constants.ts',
			'app/api/ai/route.ts',
		]

		for (const relativePath of filesToAudit) {
			const fullPath = path.join(process.cwd(), relativePath)
			if (fs.existsSync(fullPath)) {
				const content = fs.readFileSync(fullPath, 'utf-8')
				expect(content.toLowerCase()).not.toContain('gemini')
			}
		}
	})
})
