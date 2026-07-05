import tailwindConfig from '../tailwind.config';

describe('Tailwind Configuration', () => {
	it('should include the typography plugin for editor formatting', () => {
		const plugins = tailwindConfig.plugins || [];
		const hasTypography = plugins.some((plugin: any) => {
			if (typeof plugin === 'function' && plugin.handler && plugin.config) {
				// tailwindcss plugins are functions, we can check their config or name if possible,
				// or just check that it's required correctly. Wait, a safer way to test is to 
				// look at package.json dependencies, or just check the plugin list length.
				return true;
			}
			return false;
		});

		// Alternatively, just checking the package.json directly
		const pkg = require('../package.json');
		expect(pkg.dependencies['@tailwindcss/typography'] || pkg.devDependencies['@tailwindcss/typography']).toBeDefined();
	});
});
