import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  const app = new URL('/workspace', process.env.NEXT_PUBLIC_LEKHAN_APP_URL || 'https://lekhan.online')
  return {
    nav: {
      url: '/docs/getting-started',
      title: (
        <span className="lekhan-docs-brand">
          <span className="lekhan-docs-mark" aria-hidden="true">L</span>
          <span>Lekhan Docs</span>
        </span>
      ),
    },
    githubUrl: 'https://github.com/coderhd/lekhan',
    links: [{
      type: 'custom',
      children: (
        <a className="lekhan-docs-workspace-btn" href={app.href} target="_blank" rel="noreferrer noopener">
          <span>Open workspace</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>
      ),
    }],
  }
}
