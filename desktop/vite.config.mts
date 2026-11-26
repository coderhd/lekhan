import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 3192, strictPort: true },
  define: {
    'process.env.NEXT_PUBLIC_GA4_ID': '""',
    'process.env.NEXT_PUBLIC_POSTHOG_KEY': '""',
  },
})
