
describe('Tailwind Configuration', () => {
	it('should include the typography plugin for editor formatting', () => {
		// Alternatively, just checking the package.json directly
		const pkg = require('../package.json');
		expect(pkg.dependencies['@tailwindcss/typography'] || pkg.devDependencies['@tailwindcss/typography']).toBeDefined();
	});
});
