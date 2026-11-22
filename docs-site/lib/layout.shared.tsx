import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  const app = new URL('/workspace', process.env.NEXT_PUBLIC_LEKHAN_APP_URL || 'https://lekhan.online')
  return {
    nav: { title: 'Lekhan Docs', url: '/docs/getting-started' },
    githubUrl: 'https://github.com/coderhd/lekhan',
    links: [{ text: 'Open workspace', url: app.href, external: true }],
  }
}
