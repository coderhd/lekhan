import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores(['.next/**', 'next-env.d.ts', 'docs-site/**', 'desktop/dist/**', 'src-tauri/**', 'lib/lekhan.d.ts', 'lib/lekhan.variants.d.ts', 'lib/lekhan.css.d.ts', 'lib/lekhan.js']),
])
