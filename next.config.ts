import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const config: NextConfig = { devIndicators: false, serverExternalPackages: ['yjs'] }

export default createNextIntlPlugin('./lib/i18n/request.ts')(config)
