import type { Locator, Page } from '@playwright/test'

export async function chooseSelector(
	page: Page,
	scope: Page | Locator,
	label: string,
	optionName: string | RegExp,
) {
	const trigger = scope.getByRole('combobox', { name: label, exact: true })
	await trigger.evaluate(element => element.scrollIntoView({ block: 'center' }))
	await trigger.click()
	await page
		.getByRole('option', {
			name: optionName,
			exact: typeof optionName === 'string',
		})
		.click()
}
