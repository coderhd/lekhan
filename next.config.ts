import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const config: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['yjs'],
  async headers() {
    return [{
      source: '/cloud-offline-worker.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
    }, {
      source: '/cloud-offline',
      headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
    }]
  },
}

export default createNextIntlPlugin('./lib/i18n/request.ts')(config)
