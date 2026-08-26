/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{ts,tsx}',
		'./components/**/*.{ts,tsx}',
		'./app/**/*.{ts,tsx}',
		'./src/**/*.{ts,tsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: {
			colors: {
				"background": "hsl(var(--background))",
				"error": "hsl(var(--error))",
				"error-container": "hsl(var(--error-container))",
				"inverse-on-surface": "hsl(var(--inverse-on-surface))",
				"inverse-primary": "hsl(var(--inverse-primary))",
				"inverse-surface": "hsl(var(--inverse-surface))",
				"on-background": "hsl(var(--on-background))",
				"on-error": "hsl(var(--on-error))",
				"on-error-container": "hsl(var(--on-error-container))",
				"on-primary": "hsl(var(--on-primary))",
				"on-primary-container": "hsl(var(--on-primary-container))",
				"on-primary-fixed": "hsl(var(--on-primary-fixed))",
				"on-primary-fixed-variant": "hsl(var(--on-primary-fixed-variant))",
				"on-secondary": "hsl(var(--on-secondary))",
				"on-secondary-container": "hsl(var(--on-secondary-container))",
				"on-secondary-fixed": "hsl(var(--on-secondary-fixed))",
				"on-secondary-fixed-variant": "hsl(var(--on-secondary-fixed-variant))",
				"on-surface": "hsl(var(--on-surface))",
				"on-surface-variant": "hsl(var(--on-surface-variant))",
				"on-tertiary": "hsl(var(--on-tertiary))",
				"on-tertiary-container": "hsl(var(--on-tertiary-container))",
				"on-tertiary-fixed": "hsl(var(--on-tertiary-fixed))",
				"on-tertiary-fixed-variant": "hsl(var(--on-tertiary-fixed-variant))",
				"outline": "hsl(var(--outline))",
				"outline-variant": "hsl(var(--outline-variant))",
				"primary": "hsl(var(--primary))",
				"primary-ink": "hsl(var(--primary-ink))",
				"primary-container": "hsl(var(--primary-container))",
				"primary-fixed": "hsl(var(--primary-fixed))",
				"primary-fixed-dim": "hsl(var(--primary-fixed-dim))",
				"secondary": "hsl(var(--secondary))",
				"secondary-container": "hsl(var(--secondary-container))",
				"secondary-fixed": "hsl(var(--secondary-fixed))",
				"secondary-fixed-dim": "hsl(var(--secondary-fixed-dim))",
				"surface": "hsl(var(--surface))",
				"surface-bright": "hsl(var(--surface-bright))",
				"surface-container": "hsl(var(--surface-container))",
				"surface-container-high": "hsl(var(--surface-container-high))",
				"surface-container-highest": "hsl(var(--surface-container-highest))",
				"surface-container-low": "hsl(var(--surface-container-low))",
				"surface-container-lowest": "hsl(var(--surface-container-lowest))",
				"surface-dim": "hsl(var(--surface-dim))",
				"surface-tint": "hsl(var(--surface-tint))",
				"surface-variant": "hsl(var(--surface-variant))",
				"tertiary": "hsl(var(--tertiary))",
				"tertiary-container": "hsl(var(--tertiary-container))",
				"tertiary-fixed": "hsl(var(--tertiary-fixed))",
				"tertiary-fixed-dim": "hsl(var(--tertiary-fixed-dim))",
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				foreground: 'hsl(var(--foreground))',
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))',
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))',
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))',
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))',
				},
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				xl: "0.75rem",
				"2xl": "1rem",
				"3xl": "1.5rem",
			},
			spacing: {
				"xl": "40px",
				"gutter": "24px",
				"unit": "4px",
				"margin": "32px",
				"lg": "24px",
				"md": "16px",
				"xs": "4px",
				"sm": "8px"
			},
			fontFamily: {
				"label-sm": ["Inter", "sans-serif"],
				"body-md": ["Inter", "sans-serif"],
				"title-lg": ["Inter", "sans-serif"],
				"body-lg": ["Inter", "sans-serif"],
				"display-lg": ["Montserrat", "sans-serif"],
				"headline-md": ["Montserrat", "sans-serif"],
				"display-lg-mobile": ["Montserrat", "sans-serif"]
			},
			fontSize: {
				"label-sm": ["12px", {"lineHeight": "1.4", "letterSpacing": "0.05em", "fontWeight": "500"}],
				"body-md": ["14px", {"lineHeight": "1.6", "fontWeight": "400"}],
				"title-lg": ["18px", {"lineHeight": "1.5", "fontWeight": "600"}],
				"body-lg": ["16px", {"lineHeight": "1.6", "fontWeight": "400"}],
				"display-lg": ["48px", {"lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "700"}],
				"headline-md": ["24px", {"lineHeight": "1.3", "fontWeight": "600"}],
				"display-lg-mobile": ["32px", {"lineHeight": "1.2", "fontWeight": "700"}]
			},
			keyframes: {
				'accordion-down': {
					from: { height: '0' },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: '0' },
				},
				"fadeInUp": {
					"from": { "opacity": "0", "transform": "translateY(20px)" },
					"to": { "opacity": "1", "transform": "translateY(0)" }
				},
				"shimmer": {
					"0%": { "backgroundPosition": "-200% 0" },
					"100%": { "backgroundPosition": "200% 0" }
				},
				"dropdownIn": {
					"from": { "opacity": "0", "transform": "scale(0.95) translateY(-10px)" },
					"to": { "opacity": "1", "transform": "scale(1) translateY(0)" }
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				"fade-in-up": "fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
				"shimmer": "shimmer 2.5s infinite linear",
				"dropdown-in": "dropdownIn 0.2s cubic-bezier(0.4, 0, 0.2, 1) forwards"
			},
		},
	},
	plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
}
