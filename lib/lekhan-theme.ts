import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

export const lekhanTheme = defineTheme({
  name: 'lekhan',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: 'Manrope Variable',
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    heading: {
      family: 'Newsreader Variable',
      fallbacks: 'Georgia, serif',
      weights: { 1: '600', 2: '600', 3: '650', 4: '650' },
    },
    code: {
      family: 'ui-monospace',
      fallbacks: 'Consolas, monospace',
    },
  },
  tokens: {
    '--color-background-body': ['#faf9f4', '#1c241e'],
    '--color-background-surface': ['#fffef9', '#242d25'],
    '--color-background-card': ['#fffef9', '#242d25'],
    '--color-background-popover': ['#fffef9', '#242d25'],
    '--color-background-muted': ['#edf0e8', '#232f25'],
    '--color-accent': ['#294634', '#adcdac'],
    '--color-accent-muted': ['#dce7d8', '#384b3c'],
    '--color-on-accent': ['#fffef4', '#19271e'],
    '--color-text-primary': ['#222b24', '#eef1e8'],
    '--color-text-secondary': ['#586459', '#aebdaf'],
    '--color-text-accent': ['#294634', '#adcdac'],
    '--color-icon-accent': ['#294634', '#adcdac'],
    '--color-icon-primary': ['#222b24', '#eef1e8'],
    '--color-icon-secondary': ['#586459', '#aebdaf'],
    '--color-border': ['#dadecf', '#414f43'],
    '--color-border-emphasized': ['#b8c1ac', '#58695b'],
    '--color-overlay-hover': ['#e5eae0', '#344337'],
    '--color-overlay-pressed': ['#dce7d8', '#384b3c'],
    '--color-error': ['#992f2c', '#d46a66'],
    '--color-error-muted': ['#fdf3f2', '#3a2221'],
    '--color-on-error-muted': ['#7b2421', '#f5c2bf'],
    '--color-success': ['#294634', '#7fb382'],
    '--color-success-muted': ['#edf4ea', '#253829'],
    '--color-on-success-muted': ['#1e3728', '#cde4cc'],
  },
})
